/** Convert official Z-Anatomy FBX meshes into a compact, named upper-body dataset.
 * Usage: node scripts/build-anatomy.mjs /path/to/downloaded/FBX
 * Download sources and licenses: public/models/ATTRIBUTION.md.
 * No anatomical surfaces are procedurally generated. */
import fs from 'node:fs';
import path from 'node:path';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BufferGeometry, Float32BufferAttribute, Box3, Vector3 } from 'three';
const source = process.argv[2];
if (!source) throw new Error('Pass the directory containing the two official FBX files.');
globalThis.window = { URL: globalThis.URL };
const chunks = []; const meshes = []; let offset = 0;
const bone = /^(Mandible|Hyoid_bone|(?:Frontal|Occipital|Ethmoid|Sphenoid)_bone|(?:Parietal|Temporal|Zygomatic|Nasal|Palatine)_bone[lr]|Maxilla[lr]|Vomer|Vertebra_[CTL]\d+|Atlas_\(C1\)|Axis_\(C2\)|(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth)_rib[lr]|(?:Manubrium|Body)_of_sternum|Xiphoid_process|Clavicle[lr]|Scapula[lr]|Humerus[lr]|(?:Upper|Lower)_(?:medial_incisor|lateral_incisor|canine|first_premolar|second_premolar|first_molar_tooth|second_molar_tooth)[lr])$/;
const muscle = /masseter|digastric|orbicularis_oris|sternocleidomastoid|trapezius_muscle|^Levator_scapulae[lr]$|external_abdominal_oblique|rectus_abdominis|iliocostalis_thoracis|longissimus_thoracis|pectoralis_major|deltoid_muscle|temporalis_muscle|frontalis_muscle|orbicularis_oculi|zygomaticus|buccinator|mentalis|depressor_labii|levator_labii|nasalis_muscle|sternohyoid|mylohyoid/i;
const groups = [ ['masseter','jaw'],['digastric','jaw'],['orbicularis_oris','lips'],['sternocleidomastoid','neck'],['levator_scapulae','shoulders'],['trapezius','shoulders'],['external_abdominal_oblique','torso'],['rectus_abdominis','torso'],['iliocostalis_thoracis','torso'],['longissimus_thoracis','torso'],['pectoralis_major','chest'],['deltoid','shoulders'],['temporalis','jaw'] ];
for (const [file, kind] of [['SkeletalSystem100','bone'],['MuscularSystem100','muscle']]) {
 const bytes = fs.readFileSync(path.join(source, `${file}.fbx`));
 const model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''); model.updateMatrixWorld(true);
 model.traverse(o => {
  if (!o.isMesh || !(kind === 'bone' ? bone.test(o.name) : muscle.test(o.name) && !/fascia|bursa|tendon/i.test(o.name))) return;
  let g = o.geometry.clone().applyMatrix4(o.matrixWorld); if (g.index) g=g.toNonIndexed();
  // Crop below the upper abdomen; original surface coordinates are preserved.
  const positions=g.attributes.position.array;const keep=[];
  for(let i=0;i<positions.length;i+=9) if(Math.max(positions[i+1],positions[i+4],positions[i+7]) >= 108) keep.push(...positions.slice(i,i+9));
  if (!keep.length) return;
  g = mergeVertices(new BufferGeometry().setAttribute('position',new Float32BufferAttribute(keep,3)),.0001);g.computeBoundingBox();
  const b=g.boundingBox; const size=b.getSize(new Vector3());const p=g.attributes.position.array;
  const q=new Uint16Array(p.length);for(let i=0;i<p.length;i+=3){q[i]=Math.round((p[i]-b.min.x)/size.x*65535);q[i+1]=Math.round((p[i+1]-b.min.y)/size.y*65535);q[i+2]=Math.round((p[i+2]-b.min.z)/size.z*65535);}
  const indices=new Uint32Array(g.index.array);const positionOffset=offset;chunks.push(Buffer.from(q.buffer));offset+=q.byteLength;
  if(offset%4){chunks.push(Buffer.alloc(4-offset%4));offset+=4-offset%4;}
  const indexOffset=offset;chunks.push(Buffer.from(indices.buffer));offset+=indices.byteLength;
  const match=groups.find(([key])=>o.name.toLowerCase().includes(key));
  let muscleId=match?.[0]??'';if(muscleId==='external_abdominal_oblique')muscleId='external_oblique';if(/iliocostalis|longissimus/.test(muscleId))muscleId='erector_spinae';
  const bb=new Box3().setFromObject(o);const center=bb.getCenter(new Vector3());
  const rig=/^Mandible$|^Lower_/.test(o.name)?'jaw':center.y>151 && !/sternocleido|trapezius|levator_scapulae|digastric/.test(o.name.toLowerCase())?'head':'torso';
  meshes.push({name:o.name,kind,muscleId,region:match?.[1]??'general',rig,positionOffset,positionCount:q.length,indexOffset,indexCount:indices.length,min:b.min.toArray(),size:size.toArray()});
 });
}
fs.writeFileSync('public/models/upper-body.bin',Buffer.concat(chunks));
fs.writeFileSync('public/models/upper-body.json',JSON.stringify({version:1,source:'Z-Anatomy',units:'centimeters',meshes}));
console.log(`${meshes.length} anatomical meshes; ${(offset/1e6).toFixed(2)} MB; ${meshes.reduce((s,m)=>s+m.indexCount/3,0)} triangles`);
