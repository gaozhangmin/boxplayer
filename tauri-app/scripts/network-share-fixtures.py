"""Temporary loopback SMB/FTP fixtures; run in a venv with impacket and pyftpdlib.
Only synthetic credentials and files. Ctrl+C stops both services and removes the data.
"""
import json, tempfile, threading
from pathlib import Path
from impacket.smbserver import SimpleSMBServer
from impacket.ntlm import compute_lmhash, compute_nthash
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer
with tempfile.TemporaryDirectory(prefix='boxplayer-network-') as folder:
    root=Path(folder);(root/'movies').mkdir();(root/'movies'/'演示.mp4').write_bytes(b'0123456789abcdef')
    (root/'readme.txt').write_text('synthetic test fixture')
    auth=DummyAuthorizer();auth.add_user('fixture','fixture-only',folder,perm='elr')
    class Handler(FTPHandler):
        authorizer=auth
    ftp=FTPServer(('127.0.0.1',0),Handler)
    smb=SimpleSMBServer(listenAddress='127.0.0.1',listenPort=0)
    smb.setSMB2Support(True);smb.addShare('media',folder,readOnly='yes')
    smb.addCredential('fixture',0,compute_lmhash('fixture-only'),compute_nthash('fixture-only'))
    smbport=smb._SimpleSMBServer__server.server_address[1]
    threading.Thread(target=smb.start,daemon=True).start()
    print(json.dumps({'ftp':ftp.socket.getsockname()[1],'smb':smbport}),flush=True)
    try: ftp.serve_forever(timeout=0.2)
    finally: ftp.close_all();smb.stop()
