import json, numpy as np
from PIL import Image, ImageDraw
prof=json.load(open('profile.json')); S=prof['scale']; MB=prof['mast']['base']
SK=np.load('/home/claude/canton2/skel_tris.npy'); MN=np.load('/home/claude/canton2/main_tris.npy'); lab=np.load('/home/claude/canton2/main_lab.npy')
mast=MN[np.isin(lab,[0,1,2,3,4,5,6,7])].copy()
mast[:,:,0]+=27.65; mast[:,:,2]+=MB
ref=np.concatenate([SK,mast])*S
Rt=np.stack([ref[:,:,0],ref[:,:,2],-ref[:,:,1]],2)           # x, up, z(mirrored)
m=json.load(open('model.json'))
pos=np.array(m['pos']).reshape(-1,3); idx=np.array(m['idx']).reshape(-1,3); Mt=pos[idx]
def sil(tris,ax,x0,x1,y0,y1,W,H):
    im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im); sx=W/(x1-x0); sy=H/(y1-y0)
    X=(tris[:,:,ax]-x0)*sx; Y=H-(tris[:,:,1]-y0)*sy
    for i in range(len(tris)): d.polygon([(X[i,0],Y[i,0]),(X[i,1],Y[i,1]),(X[i,2],Y[i,2])],fill=255)
    return np.array(im)>0
def sheet(name,x0,x1,y0,y1,W,H):
    out=Image.new('RGB',(W*4+30,H),(120,120,120)); ious=[]
    for ax in (0,2):
        a=sil(Rt,ax,x0,x1,y0,y1,W,H); b=sil(Mt,ax,x0,x1,y0,y1,W,H); ious.append(round(float((a&b).sum()/(a|b).sum()),3))
        for j,mk in enumerate((a,b)):
            out.paste(Image.fromarray(np.where(mk,30,255).astype(np.uint8)).convert('RGB'),((2*(ax//2)+j)*(W+10),0))
    out.save(name); print(name,'overlap',ious)
sheet('shadow_canton_whole.png',-100,100,0,610,200,610)
sheet('shadow_canton_top.png',-40,40,400,610,320,840)
sheet('shadow_canton_deck.png',-40,40,420,500,640,640)
