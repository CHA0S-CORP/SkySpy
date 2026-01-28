"""
Low-level C definitions for libacars bindings.
"""
import ctypes
from enum import IntEnum

# =============================================================================
# Constants & Enums
# =============================================================================

class MsgDir(IntEnum):
    """
    ACARS message direction.
    Must match libacars/libacars.h values.
    """
    UNKNOWN = 0
    GND2AIR = 1  # Uplink (Ground -> Air)
    AIR2GND = 2  # Downlink (Air -> Ground)

# =============================================================================
# CFFI Definition
# =============================================================================

CFFI_CDEF = """
    typedef struct la_proto_node la_proto_node;
    typedef struct la_reasm_ctx la_reasm_ctx;
    typedef struct la_type_descriptor la_type_descriptor;

    // Fixed la_vstring layout: str, len, allocated_size (matches vstring.h)
    typedef struct {
        char *str;
        size_t len;
        size_t allocated_size;
    } la_vstring;

    typedef enum {
        LA_MSG_DIR_UNKNOWN = 0,
        LA_MSG_DIR_GND2AIR = 1,
        LA_MSG_DIR_AIR2GND = 2
    } la_msg_dir;

    typedef struct {
        long tv_sec;
        long tv_usec;
    } timeval;

    // Core (libacars.h)
    la_proto_node* la_acars_decode_apps(const char *label, const char *txt, la_msg_dir msg_dir);
    la_proto_node* la_proto_tree_find_protocol(la_proto_node *root, la_type_descriptor const *td);
    
    // Reassembly (reassembly.h / acars.h)
    la_reasm_ctx* la_reasm_ctx_new(void);
    void la_reasm_ctx_destroy(la_reasm_ctx *ctx);
    la_proto_node* la_acars_apps_parse_and_reassemble(const char *reg, const char *label, 
        const char *txt, la_msg_dir msg_dir, la_reasm_ctx *rtables, timeval rx_time);

    // Formatting (libacars.h)
    la_vstring* la_proto_tree_format_json(la_vstring *vstr, la_proto_node const *root);
    la_vstring* la_proto_tree_format_text(la_vstring *vstr, la_proto_node const *root);
    
    // Cleanup (libacars.h, vstring.h)
    void la_proto_tree_destroy(la_proto_node *root);
    la_vstring* la_vstring_new(void);
    void la_vstring_destroy(la_vstring *vstr, bool destroy_buffer);

    // Config setters (configuration.c / libacars.h)
    bool la_config_set_bool(char const *name, bool value);
    bool la_config_set_int(char const *name, long int value);
    bool la_config_set_double(char const *name, double value);
    bool la_config_set_str(char const *name, char const *value);
    bool la_config_unset(char *name);

    // Config getters (configuration.c / libacars.h)
    bool la_config_get_bool(char const *name, bool *result);
    bool la_config_get_int(char const *name, long int *result);
    bool la_config_get_double(char const *name, double *result);
    bool la_config_get_str(char const *name, char **result);

    // Util (acars.h)
    int la_acars_extract_sublabel_and_mfi(const char *label, la_msg_dir msg_dir,
        const char *txt, int len, char *sublabel, char *mfi);
"""

# =============================================================================
# ctypes Structures (Fallback)
# =============================================================================

class la_proto_node(ctypes.Structure):
    pass

class la_reasm_ctx(ctypes.Structure):
    pass

class la_type_descriptor(ctypes.Structure):
    pass

class la_vstring(ctypes.Structure):
    _fields_ = [
        ("str", ctypes.c_char_p),
        ("len", ctypes.c_size_t),            # Corrected order
        ("allocated_size", ctypes.c_size_t), # Corrected order
    ]

class timeval(ctypes.Structure):
    _fields_ = [
        ("tv_sec", ctypes.c_long),
        ("tv_usec", ctypes.c_long),
    ]