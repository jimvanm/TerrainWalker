import numpy as np
from PIL import Image, ImageDraw
exec(open('side_cn.py').read().split("def overlay")[0])
f=None
def shadow(tris,ax,x0,x1,y0,y1,W,H):
    return Image.fromarray(np.where(sil(tris,ax,x0,x1,y0,y1,W,H),30,255).astype(np.uint8)).convert('RGB')
def sheet(name,x0,x1,y0,y1,W,H):
    out=Image.new('RGB',(W*4+30,H),(120,120,120)); 
    for i,(tr,ax) in enumerate([(Tb,0),(Mt,0),(Tb,2),(Mt,2)]):
        out.paste(shadow(tr,ax,x0,x1,y0,y1,W,H),(i*(W+10),0))
    out.save(name)
sheet('shadow_whole.png',-100,100,0,553.3,200,553)      # 1 px per metre
sheet('shadow_top.png',-30,30,300,480,300,900)           # 5 px per metre
print('ok')
