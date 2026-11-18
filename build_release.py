from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib
p=Path(__file__).resolve().parent
version='1.29.0'
names=['index.html',f'om_echem_video_web_v{version}.html',f'echem_v{version}.js',f'fixed-video_v{version}.js',f'om-video_v{version}.js',f'tiff_v{version}.js','README.md','LICENSE','LICENSE-v1.28.0.txt','CITATION.cff','THIRD-PARTY-NOTICES.md','vendor/UTIF-3.1.0.js','vendor/UTIF-LICENSE.txt','vendor/pako-inflate-1.0.11.min.js','vendor/pako-LICENSE.txt']
if (p/'index.html').read_bytes()!=(p/f'om_echem_video_web_v{version}.html').read_bytes():raise ValueError('HTML mismatch')
output=p/'downloads'/f'OM-ECHEM-v{version}.zip';output.parent.mkdir(exist_ok=True)
with ZipFile(output,'w',ZIP_DEFLATED) as z:
 for name in names:z.write(p/name,f'OM-ECHEM-v{version}/{name}')
print(output)
print('SHA256',hashlib.sha256(output.read_bytes()).hexdigest())
