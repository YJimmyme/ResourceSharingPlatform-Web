"""舊版相容：主系統整合測試已移至 modules/vision/tests/test_host_adapter.py。"""
import sys,_vision_bridge
sys.path.insert(0,str(_vision_bridge.LAB.parent/'modules'/'vision'/'tests'))
from test_host_adapter import *
if __name__=='__main__':unittest.main()
