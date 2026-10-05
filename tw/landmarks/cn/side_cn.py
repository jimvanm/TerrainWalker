import json, numpy as np
from PIL import Image, ImageDraw
T=np.load('cn_tower_tris.npy'); N=np.load('cn_tower_names.npy'); S=553.3/1870.3
keep=~(np.isin(N,['Ground','Box001','Box002','Catwalk','Inner Bottom Railing','Shape001'])|np.array([str(n).startswith(('Edgewalk','Bottom Safety')) for n in N]))
Tb=T[keep].copy(); Tb[:,:,0]-=1.5; Tb[:,:,2]-=0.2; Tb[:,:,1]+=1.9; Tb*=S
m=json.load(open('model.json'))
pos=np.array(m['pos']).reshape(-1,3); idx=np.array(m['idx']).reshape(-1,3); Mt=pos[idx]
def sil(tris,ax,x0,x1,y0,y1,W,H):
    im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im)
    sx=W/(x1-x0); sy=H/(y1-y0)
    for t in tris:
        d.polygon([((p[ax]-x0)*sx,H-(p[1]-y0)*sy) for p in t],fill=255)
    return np.array(im)>0
def overlay(ax,x0,x1,y0,y1,W,H):
    a=sil(Tb,ax,x0,x1,y0,y1,W,H); b=sil(Mt,ax,x0,x1,y0,y1,W,H)
    o=np.full((H,W,3),255,np.uint8)
    o[a&~b]=(220,60,60)      # reference only
    o[b&~a]=(60,90,220)      # mine only
    o[a&b]=(120,120,120)     # both
    return o,(a&b).sum()/max((a|b).sum(),1)
panels=[]; 
for ax,name in ((0,'side A (x)'),(2,'side B (z)')):
    for (title,x0,x1,y0,y1,W,H) in [('whole',-70,70,0,560,280,1120//2*1),('deck 315-370',-40,40,312,372,800,600),('base 0-80',-40,40,0,60,800,600)]:
        o,iou=overlay(ax,x0,x1,y0,y1,W,H); print(name,title,'overlap %.3f'%iou)
        panels.append((name+' '+title,o))
# width profile
def prof(tris,ax,hs):
    out=[]
    for h in hs:
        lo,hi=[],[]
        mk=(tris[:,:,1].min(1)<h)&(tris[:,:,1].max(1)>h)
        for t in tris[mk]:
            for a,b in ((0,1),(1,2),(2,0)):
                p,q=t[a],t[b]
                if (p[1]-h)*(q[1]-h)<0:
                    u=(h-p[1])/(q[1]-p[1]); lo.append(p[ax]+(q[ax]-p[ax])*u)
        out.append((min(lo),max(lo)) if lo else (0,0))
    return out
hs=[x+0.013 for x in [20,100,200,300,327,329,332,335,338,341,343,346,348,351,354,358,361,364,400,445,452,500,540]]
for ax in (0,2):
    A=prof(Tb,ax,hs);B=prof(Mt,ax,hs)
    print('axis',ax); 
    for h,a,b in zip(hs,A,B): print('%6.1f ref %6.1f..%6.1f  mine %6.1f..%6.1f  dw %+.1f'%(h,a[0],a[1],b[0],b[1],(b[1]-b[0])-(a[1]-a[0])))

zs=[p for n,p in panels if 'whole' not in n]
Image.fromarray(np.vstack([np.hstack([zs[0],zs[2]]),np.hstack([zs[1],zs[3]])])).save('side_cn_zoom.png')
whole=[p for n,p in panels if 'whole' in n]
sh=Image.new('RGB',(570,whole[0].shape[0]),(255,255,255)); sh.paste(Image.fromarray(whole[0]),(0,0)); sh.paste(Image.fromarray(whole[1]),(290,0)); sh.save('side_cn_whole.png')
