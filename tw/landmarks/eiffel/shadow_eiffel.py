import json, numpy as np
from PIL import Image, ImageDraw
prof=json.load(open('profile.json')); KX=prof['scale_x']
zm=[0,24.5,46.5,105.0,114.0,120.94]; zr=[0,57.6,115.7,276.1,300.0,330.0]
t=np.load('eiffel_ref_tris.npy'); r=t.reshape(-1,3).copy()
r[:,0]*=KX; r[:,1]*=KX; r[:,2]=np.interp(r[:,2],zm,zr)
Rt=np.stack([r[:,0],r[:,2],r[:,1]],1).reshape(-1,3,3)   # x, up, depth
m=json.load(open('model.json'))
pos=np.array(m['pos']).reshape(-1,3); idx=np.array(m['idx']).reshape(-1,3); Mt=pos[idx]
def sil(tris,ax,x0,x1,y0,y1,W,H):
    im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im); sx=W/(x1-x0); sy=H/(y1-y0)
    for q in tris: d.polygon([((p[ax]-x0)*sx,H-(p[1]-y0)*sy) for p in q],fill=255)
    return np.array(im)>0
def sheet(name,x0,x1,y0,y1,W,H):
    out=Image.new('RGB',(W*4+30,H),(120,120,120)); ious=[]
    for i,(tr,ax) in enumerate([(Rt,0),(Mt,0),(Rt,2),(Mt,2)]):
        a=sil(tr,ax,x0,x1,y0,y1,W,H)
        out.paste(Image.fromarray(np.where(a,30,255).astype(np.uint8)).convert('RGB'),(i*(W+10),0))
    for ax in (0,2):
        a=sil(Rt,ax,x0,x1,y0,y1,W,H); b=sil(Mt,ax,x0,x1,y0,y1,W,H); ious.append((a&b).sum()/(a|b).sum())
    out.save(name); print(name,'overlap %.3f %.3f'%tuple(ious))
sheet('shadow_eiffel_whole.png',-90,90,0,330,180,330)
sheet('shadow_eiffel_base.png',-70,70,0,130,420,390)
sheet('shadow_eiffel_top.png',-30,30,230,330,240,400)
