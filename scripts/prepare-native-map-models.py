#!/usr/bin/env python3
"""Repack existing landmark art for native Mapbox, without changing pixels.

Native Mapbox does not decode EXT_texture_webp. Preserve all authored texture
pixels as PNG and normalize the scene to one metre high, grounded at y=0.
The shared landmark catalogue supplies each model's actual height and yaw.
"""
import io
import json
import math
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def multiply(a, b):
    return [sum(a[k*4+r] * b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]

def matrix(node):
    if 'matrix' in node:
        return node['matrix']
    x,y,z,w = node.get('rotation', [0,0,0,1])
    sx,sy,sz = node.get('scale', [1,1,1])
    tx,ty,tz = node.get('translation', [0,0,0])
    return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,
            2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,
            2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,
            tx,ty,tz,1]

def bounds(doc):
    minimum, maximum = [math.inf]*3, [-math.inf]*3
    identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
    def visit(index, parent):
        node = doc['nodes'][index]
        transform = multiply(parent, matrix(node))
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                accessor = doc['accessors'][primitive['attributes']['POSITION']]
                low, high = accessor['min'], accessor['max']
                for mask in range(8):
                    point = [high[i] if mask & (1<<i) else low[i] for i in range(3)] + [1]
                    for axis in range(3):
                        value = sum(transform[k*4+axis]*point[k] for k in range(4))
                        minimum[axis] = min(minimum[axis],value)
                        maximum[axis] = max(maximum[axis],value)
        for child in node.get('children', []):
            visit(child, transform)
    for root in doc['scenes'][doc.get('scene',0)]['nodes']:
        visit(root, identity)
    return minimum, maximum

def convert(source, destination, car=False):
    blob = source.read_bytes()
    json_size = struct.unpack_from('<I',blob,12)[0]
    doc = json.loads(blob[20:20+json_size])
    binary = bytearray(blob[28+json_size:])
    for image in doc.get('images', []):
        if image.get('mimeType') != 'image/webp':
            continue
        view = doc['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset',0)
        decoded = Image.open(io.BytesIO(binary[offset:offset+view['byteLength']])).convert('RGBA')
        png = io.BytesIO(); decoded.save(png,format='PNG')
        encoded = png.getvalue()
        assert Image.open(io.BytesIO(encoded)).tobytes() == decoded.tobytes()
        binary.extend(b'\0'*(-len(binary)%4))
        image['bufferView'] = len(doc['bufferViews']); image['mimeType'] = 'image/png'
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(encoded)})
        binary.extend(encoded)
    for texture in doc.get('textures', []):
        extensions = texture.get('extensions',{})
        if 'EXT_texture_webp' in extensions:
            texture['source'] = extensions.pop('EXT_texture_webp')['source']
        if not extensions:
            texture.pop('extensions',None)
    for key in ['extensionsUsed','extensionsRequired']:
        if key in doc:
            doc[key] = [value for value in doc[key] if value != 'EXT_texture_webp']
    low, high = bounds(doc)
    scene = doc['scenes'][doc.get('scene',0)]
    if car and high[0]-low[0] > high[2]-low[2]:
        turn = {'children':scene['nodes'], 'rotation':[0,math.sin(math.pi/4),0,math.cos(math.pi/4)]}
        scene['nodes'] = [len(doc['nodes'])]; doc['nodes'].append(turn)
        low, high = bounds(doc)
    height = high[1]-low[1]
    assert height > 0 and math.isfinite(height), source
    scene = doc['scenes'][doc.get('scene',0)]
    scale = 5/(high[2]-low[2]) if car else 1/height
    wrapper = {'name':'Poplur shared grounded normalization','children':scene['nodes'],
               'scale':[scale]*3,'translation':[-(low[0]+high[0])/2*scale,-low[1]*scale,-(low[2]+high[2])/2*scale]}
    scene['nodes'] = [len(doc['nodes'])]; doc['nodes'].append(wrapper)
    doc['buffers'][0]['byteLength'] = len(binary)
    binary.extend(b'\0'*(-len(binary)%4))
    content = json.dumps(doc,separators=(',',':')).encode(); content += b' '*(-len(content)%4)
    result = struct.pack('<III',0x46546c67,2,28+len(content)+len(binary)) + struct.pack('<II',len(content),0x4e4f534a)+content+struct.pack('<II',len(binary),0x004e4942)+binary
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(result)
    return {'asset':str(destination.relative_to(ROOT/'public')), 'height':height, 'sourceBytes':len(blob), 'nativeBytes':len(result), 'pixelsPreserved':True}

if __name__ == '__main__':
    manifest = {}
    for source in sorted((ROOT/'public/landmarks').glob('*.glb')):
        manifest[source.stem] = convert(source,ROOT/'public/native-map/landmarks'/source.name)
    car_source = ROOT/'public/poplur_navigation_car.glb'
    manifest['navigation-car'] = convert(car_source,ROOT/'public/native-map/navigation-car.glb',car=True)
    (ROOT/'public/native-map/model-compatibility.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Converted {len(manifest)} existing landmark models with identical texture pixels.')
