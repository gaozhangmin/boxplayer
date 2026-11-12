# Deterministic neutral 10-bit signal charts; no measured display luminance claim.
import argparse, array, json, math, pathlib, subprocess, tempfile
P = {
'0':['01110','10001','10011','10101','11001','10001','01110'], '1':['00100','01100','00100','00100','00100','00100','01110'], '2':['01110','10001','00001','00010','00100','01000','11111'], '3':['11110','00001','00001','01110','00001','00001','11110'], '4':['00010','00110','01010','10010','11111','00010','00010'], '5':['11111','10000','10000','11110','00001','00001','11110'], '6':['01110','10000','10000','11110','10001','10001','01110'], '7':['11111','00001','00010','00100','01000','01000','01000'], '8':['01110','10001','10001','01110','10001','10001','01110'], '9':['01110','10001','10001','01111','00001','00001','01110'], '.':['00000','00000','00000','00000','00000','00110','00110'],
'A':['01110','10001','10001','11111','10001','10001','10001'],'B':['11110','10001','10001','11110','10001','10001','11110'],'C':['01111','10000','10000','10000','10000','10000','01111'],'D':['11110','10001','10001','10001','10001','10001','11110'],'E':['11111','10000','10000','11110','10000','10000','11111'],'G':['01111','10000','10000','10111','10001','10001','01111'],'H':['10001','10001','10001','11111','10001','10001','10001'],'I':['11111','00100','00100','00100','00100','00100','11111'],'L':['10000','10000','10000','10000','10000','10000','11111'],'M':['10001','11011','10101','10101','10001','10001','10001'],'N':['10001','11001','10101','10011','10001','10001','10001'],'O':['01110','10001','10001','10001','10001','10001','01110'],'P':['11110','10001','10001','11110','10000','10000','10000'],'Q':['01110','10001','10001','10001','10101','10010','01101'],'R':['11110','10001','10001','11110','10100','10010','10001'],'S':['01111','10000','10000','01110','00001','00001','11110'],'T':['11111','00100','00100','00100','00100','00100','00100'],'U':['10001','10001','10001','10001','10001','10001','01110'],'V':['10001','10001','10001','10001','10001','01010','00100'],'W':['10001','10001','10001','10101','10101','10101','01010'],'Y':['10001','10001','01010','00100','00100','00100','00100'],' ':['00000']*7}
W,H=1920,1080
# ITU-R BT.2100 / SMPTE ST 2084 constants. L is nominal absolute signal cd/m^2.
def pq(l):
    m1,m2,c1,c2,c3=2610/16384,2523/32,3424/4096,2413/128,2392/128
    a=(l/10000)**m1
    return ((c1+c2*a)/(1+c3*a))**m2

def create(name, values, hdr, directory, ffmpeg):
    code=lambda value: round(64+876*(pq(value) if hdr else value))
    y=array.array('H',[64])*(W*H)
    def rect(x0,y0,w,h,v):
        row=array.array('H',[v])*w
        for yy in range(y0,y0+h): y[yy*W+x0:yy*W+x0+w]=row
    def text(s,x0,y0,scale,v):
        for ch in s:
            for dy,row in enumerate(P[ch]):
                for dx,on in enumerate(row):
                    if on=='1': rect(x0+dx*scale,y0+dy*scale,scale,scale,v)
            x0+=6*scale
    label=code(10 if hdr and max(values)<=5 else 100 if hdr else .6)
    text('HDR PQ SIGNAL NITS' if hdr else 'SDR SIGNAL LEVEL',32,36,5,label)
    text('NOT MEASURED DISPLAY NITS',32,100,4,label)
    width=(W-64)//len(values)
    patches=[]
    for i,value in enumerate(values):
        x=32+i*width
        rect(x,210,width-12,630,code(value))
        text(str(value),x+8,875,4,label)
        patches.append({'signalValue':value,'y10':code(value),'sampleXY':[x+(width-12)//2,525]})
    frame=y+array.array('H',[512])*(W*H//2)
    with tempfile.TemporaryDirectory() as temp:
        raw=pathlib.Path(temp)/'frame.yuv';raw.write_bytes(frame.tobytes())
        target=directory/name
        args=[ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','yuv420p10le','-video_size',f'{W}x{H}','-framerate','1','-i',str(raw),'-vf','loop=loop=9:size=1:start=0,setparams=range=limited:color_primaries='+('bt2020' if hdr else 'bt709')+':color_trc='+('smpte2084' if hdr else 'bt709')+':colorspace='+('bt2020nc' if hdr else 'bt709'),'-frames:v','10','-c:v','ffv1','-level','3','-g','1','-color_range','tv','-color_primaries','bt2020' if hdr else 'bt709','-color_trc','smpte2084' if hdr else 'bt709','-colorspace','bt2020nc' if hdr else 'bt709',str(target)]
        subprocess.run(args,check=True)
        probe=subprocess.run([ffmpeg,'-hide_banner','-i',str(target),'-frames:v','1','-f','null','-'],capture_output=True,check=True).stderr.decode()
        expected='bt2020nc/bt2020/smpte2084' if hdr else 'bt709'
        assert expected in probe, 'Missing decoded color metadata: '+probe
        decoded=subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p10le','-'],capture_output=True,check=True).stdout
        decoded_y=array.array('H');decoded_y.frombytes(decoded[:W*H*2])
        for patch in patches:
            x,yy=patch['sampleXY'];assert decoded_y[yy*W+x]==patch['y10'],patch
        return {'file':name,'hdr':hdr,'codec':'FFV1 lossless','pixelFormat':'yuv420p10le','durationSeconds':10,'patches':patches,'decodedCenterCodesVerified':True}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--ffmpeg',required=True);a=parser.parse_args()
    directory=pathlib.Path(a.output);directory.mkdir(parents=True,exist_ok=True)
    charts=[create('BoxPlayer HDR highlight steps.mkv',[100,203,400,600,1000,1600],True,directory,a.ffmpeg),create('BoxPlayer HDR near black.mkv',[0,.005,.01,.05,.1,.5,1,5],True,directory,a.ffmpeg),create('BoxPlayer SDR gray steps.mkv',[0,.01,.02,.05,.1,.25,.5,.75,1],False,directory,a.ffmpeg)]
    (directory/'signal-manifest.json').write_text(json.dumps({'standard':'BT.2100 PQ / ST 2084','purpose':'Nominal signal patterns, not a calibrated display measurement','charts':charts},indent=2))
    print(json.dumps({'generated':[c['file'] for c in charts],'losslessCenterCodesVerified':True}))
