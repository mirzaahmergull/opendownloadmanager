"""Structural and binary-integrity checks. These are not native Mac launch tests."""
from pathlib import Path,PurePosixPath
import zipfile,stat,plistlib,json,struct,hashlib
ROOT=Path(__file__).resolve().parent.parent
VERSION=json.loads((ROOT/'package.json').read_text())['version']
APP='Open Download Manager.app/Contents/'

def slices(data):
    magic=data[:4]
    if magic in [b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf']:
        count=struct.unpack_from('>I',data,4)[0];fat64=magic[-1]==0xbf
        for n in range(count):
            if fat64:cpu,sub,offset,size,align,reserved=struct.unpack_from('>IIQQII',data,8+n*32)
            else:cpu,sub,offset,size,align=struct.unpack_from('>IIIII',data,8+n*20)
            yield cpu,data[offset:offset+size]
    elif magic in [b'\xcf\xfa\xed\xfe',b'\xce\xfa\xed\xfe']:
        yield struct.unpack_from('<I',data,4)[0],data

def verify_pages(data):
    signed=0
    for cpu,binary in slices(data):
        offset=32 if binary[:4]==b'\xcf\xfa\xed\xfe' else 28
        for _ in range(struct.unpack_from('<I',binary,16)[0]):
            command,size=struct.unpack_from('<II',binary,offset)
            if command==0x1d:
                base,length=struct.unpack_from('<II',binary,offset+8)
                magic,total,count=struct.unpack_from('>III',binary,base)
                assert magic==0xfade0cc0,'Bad signature blob'
                for i in range(count):
                    slot,relative=struct.unpack_from('>II',binary,base+12+i*8)
                    if slot not in [0,0x1000,0x1001,0x1002,0x1003,0x1004,0x1005]:continue
                    at=base+relative;head=struct.unpack_from('>9I',binary,at)
                    assert head[0]==0xfade0c02,'Bad code directory'
                    hash_offset,slots,limit=head[4],head[7],head[8]
                    hash_size,hash_type,page_exp=struct.unpack_from('BBB',binary,at+36)[0],binary[at+37],binary[at+39]
                    if limit==0xffffffff and head[2]>=0x20300:limit=struct.unpack_from('>Q',binary,at+56)[0]
                    algorithm={1:'sha1',2:'sha256',3:'sha256',4:'sha384'}[hash_type]
                    page_size=2**page_exp if page_exp else limit
                    for page in range(slots):
                        expected=binary[at+hash_offset+page*hash_size:at+hash_offset+(page+1)*hash_size]
                        payload=binary[page*page_size:min(limit,(page+1)*page_size)]
                        assert hashlib.new(algorithm,payload).digest()[:hash_size]==expected,'Mach-O code page checksum mismatch'
                    signed+=1
            offset+=size
    return signed

for arch,cpu in [('arm64',0x100000c),('x64',0x1000007)]:
    file=ROOT/'release'/f'OpenDownloadManager-{VERSION}-macOS-{arch}.zip'
    with zipfile.ZipFile(file) as archive:
        infos=archive.infolist();names=set(archive.namelist());assert archive.testzip() is None,'ZIP CRC error'
        plist=plistlib.loads(archive.read(APP+'Info.plist'))
        assert plist['CFBundleIdentifier']=='org.opendownloadmanager.desktop'
        assert plist['CFBundleExecutable']=='Open Download Manager'
        assert plist['CFBundleShortVersionString']==VERSION and plist['LSMinimumSystemVersion']=='13.0'
        asar=archive.read(APP+'Resources/app.asar');length=struct.unpack_from('<I',asar,12)[0];header=asar[16:16+length]
        assert hashlib.sha256(header).hexdigest()==plist['ElectronAsarIntegrity']['Resources/app.asar']['hash'],'ASAR header integrity mismatch'
        files=json.loads(header)['files'];assert 'modern-renderer.js' in files['src']['files'] and 'platform.cjs' in files['src']['files']
        data_base=8+struct.unpack_from('<I',asar,4)[0]
        for source in (ROOT/'src').iterdir():
            if not source.is_file():continue
            entry=files['src']['files'][source.name];start=data_base+int(entry['offset'])
            assert asar[start:start+entry['size']]==source.read_bytes(),f'Mac ASAR source differs: {source.name}'
        def inspect_asar(tree):
            for name,entry in tree.items():
                assert not name.endswith(('.exe','.dll','.node','.pdb','.lib')),f'Platform binary remained in ASAR: {name}'
                if 'files' in entry:inspect_asar(entry['files'])
        inspect_asar(files)
        links=0;signatures=0;binaries=0
        def normalize(value):
            parts=[]
            for part in value.split('/'):
                if part=='..':
                    assert parts, 'Framework link escapes archive'
                    parts.pop()
                elif part and part!='.':parts.append(part)
            return '/'.join(parts)
        def resolve_link(value):
            value=normalize(value)
            for attempt in range(40):
                parts=value.split('/');changed=False
                for index in range(1,len(parts)+1):
                    prefix='/'.join(parts[:index])
                    if prefix not in names:continue
                    entry=archive.getinfo(prefix)
                    if stat.S_ISLNK(entry.external_attr>>16):
                        destination=archive.read(entry).decode()
                        assert not destination.startswith('/'), 'Absolute framework link'
                        parent=str(PurePosixPath(prefix).parent)
                        value=normalize(parent+'/'+destination+'/'+('/'.join(parts[index:])))
                        changed=True;break
                if not changed:return value
            raise AssertionError('Framework symlink cycle')
        for info in infos:
            mode=info.external_attr>>16
            if stat.S_ISLNK(mode):
                links+=1;target=resolve_link(info.filename)
                assert target in names or target+'/' in names or any(n.startswith(target+'/') for n in names),f'Broken framework link: {info.filename}'
            if info.filename.endswith('/Contents/Info.plist') and '.app/Contents/' in info.filename:
                bundle=plistlib.loads(archive.read(info));executable=bundle.get('CFBundleExecutable')
                if executable:assert str(PurePosixPath(info.filename).parent/'MacOS'/executable) in names,f'Missing bundle executable: {executable}'
            if info.filename.startswith(APP+'Resources/tools/') and info.filename.rsplit('/',1)[-1] in ['yt-dlp','ffmpeg','ffprobe','7zz']:
                assert mode&0o111,'Missing tool executable permission';data=archive.read(info);assert cpu in [c for c,b in slices(data)],'Wrong tool architecture';binaries+=1;signatures+=verify_pages(data)
            if '/MacOS/' in info.filename and not info.is_dir() and not stat.S_ISLNK(mode):
                assert mode&0o111,'Missing app executable permission';data=archive.read(info);assert cpu in [c for c,b in slices(data)],'Wrong Electron architecture';binaries+=1;signatures+=verify_pages(data)
        assert links>=14 and binaries>=8
        assert not any(n.endswith(('.exe','.dll')) for n in names),'Windows executable in Mac bundle'
        assert APP+'Resources/extension/manifest.json' in names
        assert APP+'Resources/tools/licenses/sources.json' in names
        print(f'PASS {arch}: ZIP CRCs, {links} valid framework links, {binaries} native executables, {signatures} verified code directories, plist/executable paths, ASAR integrity and native tools. Mac launch not performed.')
