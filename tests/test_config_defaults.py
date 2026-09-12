"""Default write-root lists, asserted directly on the module -- deliberately
no sandbox fixture here, since that fixture monkeypatches both lists to []."""
import backend.config as _config


def test_default_root_lists():
    assert len(_config.SYSTEM_WRITE_ROOTS) == 4
    assert _config.PROTECTED_WRITE_ROOTS == _config.SYSTEM_WRITE_ROOTS + [_config.FILEPLUS_APP_DIR]
