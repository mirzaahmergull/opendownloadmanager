"""Assemble Mac app ZIPs on Windows without losing POSIX links or permissions.

Uses verified official Electron distributions and the tested app ASAR. It does
not run the Mac binaries, claim Developer ID signing, or notarize anything.
"""
from pathlib import Path,PurePosixPath
import zipfile,plistlib,json,copy,stat,hashlib,struct
ROOT=Path(__file__).resolve().parent.parent
META=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
RELEASE=json.loads((ROOT/'.build-cache/electron-macos-release.json').read_text())
INTEGRITY=json.loads((ROOT/'.build-cache/mac-asar-integrity.json').read_text())
APP='Open Download Manager'
PREFIX=APP+'.app/'

def remap(name):
    name=name.replace('Electron.app/',PREFIX,1)
    parts=name.split('/')
    for i,part in enumerate(parts):
        if part=='Electron' or part.startswith('Electron Helper') or part.startswith('Electron Login Helper'):
            parts[i]=part.replace('Electron',APP,1)
    return '/'.join(parts)

def add_file(archive,name,data,mode=0o644):
    info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=(stat.S_IFREG|mode)<<16;info.compress_type=zipfile.ZIP_DEFLATED
    archive.writestr(info,data,compresslevel=4)

for arch in ['arm64','x64']:
    name=f"electron-v{RELEASE['version']}-darwin-{arch}.zip"
    source=ROOT/'.build-cache'/name
    asset=next(a for a in RELEASE['assets'] if a['name']==name)
    if 'sha256:'+hashlib.sha256(source.read_bytes()).hexdigest()!=asset['digest']:raise ValueError('Electron checksum mismatch')
    output=ROOT/'release'/f"OpenDownloadManager-{META['version']}-macOS-{arch}.zip"
    with zipfile.ZipFile(source) as original,zipfile.ZipFile(output,'w',allowZip64=True,compression=zipfile.ZIP_DEFLATED,compresslevel=4) as dest:
        for info in original.infolist():
            if not info.filename.startswith('Electron.app/'):
                if info.filename in ['LICENSE','LICENSES.chromium.html']:
                    add_file(dest,PREFIX+'Contents/Resources/licenses/Electron-'+info.filename,original.read(info))
                continue
            if info.filename in ['Electron.app/Contents/Resources/default_app.asar','Electron.app/Contents/Resources/electron.icns']:continue
            target=remap(info.filename);data=original.read(info)
            if info.filename.endswith('/Info.plist'):
                values=plistlib.loads(data)
                if info.filename=='Electron.app/Contents/Info.plist':
                    values.update(CFBundleExecutable=APP,CFBundleName=APP,CFBundleDisplayName=APP,CFBundleIdentifier=META['build']['appId'],CFBundleShortVersionString=META['version'],CFBundleVersion=META['version'],CFBundleIconFile='icon.icns',LSApplicationCategoryType='public.app-category.utilities',ElectronAsarIntegrity={'Resources/app.asar':INTEGRITY},NSHumanReadableCopyright='Open Download Manager contributors')
                    # Preserve upstream minimum OS; Electron 44 requires macOS 13.
                    values['LSMinimumSystemVersion']='13.0'
                elif 'Electron Helper' in info.filename or 'Electron Login Helper' in info.filename:
                    executable=values.get('CFBundleExecutable','').replace('Electron',APP,1)
                    values['CFBundleExecutable']=executable;values['CFBundleName']=executable;values['CFBundleDisplayName']=executable;values['CFBundleVersion']=META['version'];suffix=executable.removeprefix(APP+' Helper').strip().strip('()')
                    values['CFBundleIdentifier']=META['build']['appId']+('.loginhelper' if 'Login Helper' in executable else '.helper'+('.'+suffix if suffix else ''))
                data=plistlib.dumps(values,sort_keys=False)
            rewritten=copy.copy(info);rewritten.filename=target;rewritten.compress_type=zipfile.ZIP_DEFLATED
            # Copy the original ZIP metadata: symlink payloads stay links, Mach-O files stay executable.
            dest.writestr(rewritten,data,compresslevel=4)
        resources=PREFIX+'Contents/Resources/'
        add_file(dest,resources+'app.asar',(ROOT/'.build-cache/app-macos.asar').read_bytes())
        add_file(dest,resources+'icon.icns',(ROOT/'assets/app.icns').read_bytes())
        add_file(dest,resources+'THIRD_PARTY.md',(ROOT/'THIRD_PARTY.md').read_bytes())
        for folder,destination in [(ROOT/'tools-macos'/arch,'tools'),(ROOT/'extension','extension')]:
            for file in sorted(folder.rglob('*')):
                if file.is_file():
                    relative=file.relative_to(folder).as_posix()
                    executable=destination=='tools' and relative in ['yt-dlp','ffmpeg','ffprobe','7zz']
                    add_file(dest,resources+destination+'/'+relative,file.read_bytes(),0o755 if executable else 0o644)
        for doc in ['BATCHES.md','MACOS.md','README.md','PERFORMANCE.md','VERIFICATION.md','BUILD_NOTES.md','FEATURE_RESEARCH.md','REDESIGN_PLAN.md','STABILITY_ITERATIONS.md','THIRD_PARTY.md','LICENSE']:
            if (ROOT/doc).exists():add_file(dest,doc,(ROOT/doc).read_bytes())
    print(f'Assembled {output.name}: {output.stat().st_size:,} bytes; native launch remains untested.')
