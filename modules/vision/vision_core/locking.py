"""One serving process per dataset, including legacy and standalone entrypoints."""
import os
_handle=None
def acquire(root):
    global _handle
    path=root/'.service.lock';f=open(path,'a+b')
    if path.stat().st_size==0:f.write(b'0');f.flush()
    f.seek(0)
    try:
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except (OSError,IOError):
        f.close();raise RuntimeError('同一資料夾已有 YOLO 服務使用中，請先關閉原服務，或指定不同 VISION_DATA_DIR。')
    _handle=f
