"""
Regression tests for the libacars UNKNOWN-direction SIGSEGV.

Root cause: ``la_cpdlc_parse`` / ``la_adsc_parse`` pick their ASN.1 type
descriptor (resp. tag table) from the message direction and leave it ``NULL`` for
``LA_MSG_DIR_UNKNOWN``. The only guard is ``la_assert(... != NULL)``, compiled to a
no-op in the release build, so the decoder then dereferences NULL and the whole
process crashes with SIGSEGV. ``la_acars_decode_apps`` (our entry point) does not
guess the direction from the ACARS block-ID, so an UNKNOWN direction reaches those
decoders unresolved.

The binding fixes this by coercing UNKNOWN to a concrete direction (AIR2GND) before
every native decode call, so libacars never sees UNKNOWN. These tests lock that in.
"""

from skyspy_common.libacars import MsgDir, decode_acars_apps
from skyspy_common.libacars.api import _c_msg_dir


class TestCMsgDirCoercion:
    def test_unknown_is_coerced_to_a_concrete_direction(self):
        # The whole point: UNKNOWN must never survive to the native call.
        assert _c_msg_dir(MsgDir.UNKNOWN) != int(MsgDir.UNKNOWN)
        assert _c_msg_dir(MsgDir.UNKNOWN) == int(MsgDir.AIR2GND)
        assert _c_msg_dir(0) == int(MsgDir.AIR2GND)

    def test_known_directions_pass_through_unchanged(self):
        assert _c_msg_dir(MsgDir.GND2AIR) == int(MsgDir.GND2AIR)
        assert _c_msg_dir(MsgDir.AIR2GND) == int(MsgDir.AIR2GND)

    def test_out_of_range_direction_is_coerced(self):
        # Any value that is not a valid GND2AIR/AIR2GND must be coerced too, so a
        # bad int can't slip an UNKNOWN-equivalent (or garbage) into the decoder.
        assert _c_msg_dir(99) == int(MsgDir.AIR2GND)


class TestNativeCallNeverGetsUnknown:
    def test_decode_with_unknown_direction_passes_concrete_dir_to_native(self, mock_successful_decode):
        mock_lib = mock_successful_decode

        # A CPDLC-carrying ARINC label (H1) — exactly the payload class that
        # segfaulted — decoded with UNKNOWN direction.
        decode_acars_apps("H1", "/AKLCDYA.AT1.N123AB", MsgDir.UNKNOWN, use_cache=False)

        assert mock_lib.la_acars_decode_apps.called
        _label, _text, c_dir = mock_lib.la_acars_decode_apps.call_args[0]
        assert c_dir != int(MsgDir.UNKNOWN), "UNKNOWN direction reached the native decoder — would SIGSEGV"
        assert c_dir == int(MsgDir.AIR2GND)

    def test_decode_with_known_direction_is_untouched(self, mock_successful_decode):
        mock_lib = mock_successful_decode
        decode_acars_apps("H1", "/AKLCDYA.AT1.N123AB", MsgDir.GND2AIR, use_cache=False)

        _label, _text, c_dir = mock_lib.la_acars_decode_apps.call_args[0]
        assert c_dir == int(MsgDir.GND2AIR)
