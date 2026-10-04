// Builds a real MVT byte stream by hand, then checks the decoder recovers it.
import { decodeMVT, POLYGON, LINESTRING } from '../src/mvt.js';

const B = [];
const varint = (n) => { const o=[]; while(n>=0x80){o.push((n&0x7f)|0x80); n=Math.floor(n/128);} o.push(n); return o; };
const key = (f,w)=>varint((f<<3)|w);
const str = (f,s)=>{ const b=[...new TextEncoder().encode(s)]; return [...key(f,2),...varint(b.length),...b]; };
const msg = (f,body)=>[...key(f,2),...varint(body.length),...body];
const packed = (f,nums)=>{ const b=[]; for(const n of nums) b.push(...varint(n)); return [...key(f,2),...varint(b.length),...b]; };
const zz = (n)=> n<0 ? (-n*2-1) : n*2;
const cmd = (id,count)=>(id&0x7)|(count<<3);

// A square ring 0,0 -> 100,0 -> 100,100 -> 0,100 closed, plus a 2-point line.
const sq = [cmd(1,1), zz(0), zz(0), cmd(2,3), zz(100),zz(0), zz(0),zz(100), zz(-100),zz(0), cmd(7,0)];
const ln = [cmd(1,1), zz(10), zz(20), cmd(2,1), zz(30), zz(40)];

const featPoly = msg(2, [...packed(2,[0,0]), ...key(3,0), ...varint(POLYGON), ...packed(4,sq)]);
const featLine = msg(2, [...packed(2,[0,1]), ...key(3,0), ...varint(LINESTRING), ...packed(4,ln)]);
const waterLayer = msg(3, [
  ...str(1,'water'), ...featPoly,
  ...str(3,'class'),
  ...msg(4, str(1,'lake')), ...msg(4, str(1,'river')),
  ...key(5,0), ...varint(4096), ...key(15,0), ...varint(2),
]);
const wwLayer = msg(3, [
  ...str(1,'waterway'), ...featLine,
  ...str(3,'class'), ...msg(4, str(1,'x')), ...msg(4, str(1,'stream')),
  ...key(5,0), ...varint(4096),
]);
const other = msg(3, [...str(1,'building'), ...key(5,0), ...varint(4096)]);

const bytes = new Uint8Array([...waterLayer, ...other, ...wwLayer]);
const r = decodeMVT(bytes, ['water','waterway']);

const R=[]; const ok=(c,m)=>{R.push((c?'PASS  ':'FAIL  ')+m); if(!c)process.exitCode=1;};
ok(!!r.water, 'found the water layer');
ok(!r.building, 'ignored layers not asked for');
ok(r.water.extent===4096, `extent ${r.water && r.water.extent}`);
ok(r.water.features.length===1, 'one water feature');
const f=r.water.features[0];
ok(f.type===POLYGON, 'geometry type is POLYGON');
ok(f.cls==='lake', `resolved class tag = ${f.cls}`);
ok(f.parts.length===1, 'one ring');
const want=[0,0, 100,0, 100,100, 0,100, 0,0];
ok(JSON.stringify(f.parts[0])===JSON.stringify(want),
   `ring decoded: [${f.parts[0]}]`);
const w=r.waterway.features[0];
ok(w && w.type===LINESTRING && w.cls==='stream', `waterway line, class=${w&&w.cls}`);
ok(JSON.stringify(w.parts[0])===JSON.stringify([10,20,40,60]), `line: [${w.parts[0]}]`);

// varints past 2^31 must survive (JS << would corrupt these)
const big = msg(3, [...str(1,'water'), ...key(5,0), ...varint(3000000000)]);
ok(decodeMVT(new Uint8Array(big),['water']).water.extent===3000000000, 'large varint (>2^31) intact');
console.log(R.join('\n'));

// --- UV derivation must map tile-local positions to 0..1 across the tile ---
{
  const { buildMesh } = await import('../src/worker.js');
  const { tileSizeMerc } = await import('../src/geo.js');
  const h = new Float32Array(256*256);
  const m = buildMesh(h, 12, 32);
  const size = tileSizeMerc(12);
  let lo=Infinity, hi=-Infinity, bad=0;
  const V=33;
  for (let i=0;i<V*V;i++){
    const u = m.positions[i*4]/size + 0.5, v = m.positions[i*4+2]/size + 0.5;
    lo=Math.min(lo,u,v); hi=Math.max(hi,u,v);
    if (u<-1e-6||u>1+1e-6||v<-1e-6||v>1+1e-6) bad++;
  }
  const okUV = bad===0 && Math.abs(lo)<1e-6 && Math.abs(hi-1)<1e-6;
  console.log(`${okUV?'PASS':'FAIL'}  UV spans exactly 0..1 across the tile (min ${lo.toFixed(6)}, max ${hi.toFixed(6)})`);
  if(!okUV) process.exitCode=1;

  // Skirt vertices must inherit their edge's UV, or shorelines tear at seams.
  const base=V*V;
  let same=true;
  for (let t=0;t<V;t++){
    if (m.positions[(base+t)*4]!==m.positions[t*4] ||
        m.positions[(base+t)*4+2]!==m.positions[t*4+2]) same=false;
  }
  console.log(`${same?'PASS':'FAIL'}  skirt vertices inherit edge UV (no tearing at LOD seams)`);
  if(!same) process.exitCode=1;
}
