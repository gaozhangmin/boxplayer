/*
 * libmpv wrapper implementation
 */

#include "mpv_context.h"
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>

#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
#ifdef _WIN32
#include <windows.h>
#include <gl/GL.h>
// WGL function types (wglGetProcAddress is in wingdi.h)
typedef HGLRC(WINAPI* PFNWGLCREATECONTEXTATTRIBSARBPROC)(HDC, HGLRC, const int*);
typedef BOOL(WINAPI* PFNWGLMAKECURRENTPROC)(HDC, HGLRC);
typedef PROC(WINAPI* PFNWGLGETPROCADDRESSPROC)(LPCSTR);
#elif defined(__APPLE__)
#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl3.h>
#include <OpenGL/OpenGL.h>
#include <dlfcn.h>
#else
#include <GL/gl.h>
#include <GL/glx.h>
#endif
#endif

namespace mpv_texture {

MpvContext::MpvContext() = default;

MpvContext::~MpvContext() {
    destroy();
}

// Platform-specific GL context creation
#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
#ifdef _WIN32
static HWND g_dummyWindow = nullptr;
static HDC g_hdc = nullptr;
static HGLRC g_hglrc = nullptr;

static bool createWindowsGLContext() {
    // Register dummy window class
    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = "MpvTextureDummyWindow";
    RegisterClassA(&wc);

    // Create hidden window
    g_dummyWindow = CreateWindowExA(
        0, "MpvTextureDummyWindow", "", 0,
        0, 0, 1, 1, nullptr, nullptr,
        GetModuleHandle(nullptr), nullptr
    );
    if (!g_dummyWindow) {
        std::cerr << "[MpvContext] Failed to create dummy window" << std::endl;
        return false;
    }

    g_hdc = GetDC(g_dummyWindow);
    if (!g_hdc) {
        std::cerr << "[MpvContext] Failed to get DC" << std::endl;
        return false;
    }

    // Set pixel format
    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.iLayerType = PFD_MAIN_PLANE;

    int pixelFormat = ChoosePixelFormat(g_hdc, &pfd);
    if (!pixelFormat || !SetPixelFormat(g_hdc, pixelFormat, &pfd)) {
        std::cerr << "[MpvContext] Failed to set pixel format" << std::endl;
        return false;
    }

    // Create OpenGL context
    g_hglrc = wglCreateContext(g_hdc);
    if (!g_hglrc) {
        std::cerr << "[MpvContext] Failed to create GL context" << std::endl;
        return false;
    }

    // Make it current
    if (!wglMakeCurrent(g_hdc, g_hglrc)) {
        std::cerr << "[MpvContext] Failed to make GL context current" << std::endl;
        return false;
    }

    // Check which GPU the OpenGL context is using
    const char* vendor = (const char*)glGetString(GL_VENDOR);
    const char* renderer = (const char*)glGetString(GL_RENDERER);
    std::cout << "[MpvContext] OpenGL Vendor: " << (vendor ? vendor : "unknown") << std::endl;
    std::cout << "[MpvContext] OpenGL Renderer: " << (renderer ? renderer : "unknown") << std::endl;

    // Check if we're on NVIDIA - WGL_NV_DX_interop requires both D3D and GL on same GPU
    if (renderer && strstr(renderer, "NVIDIA") == nullptr) {
        std::cerr << "[MpvContext] WARNING: OpenGL is not on NVIDIA GPU. WGL_NV_DX_interop may fail." << std::endl;
        std::cerr << "[MpvContext] Set NVIDIA as preferred GPU for this app in NVIDIA Control Panel." << std::endl;
    }

    std::cout << "[MpvContext] Windows GL context created successfully" << std::endl;
    return true;
}

static void destroyWindowsGLContext() {
    if (g_hglrc) {
        wglMakeCurrent(nullptr, nullptr);
        wglDeleteContext(g_hglrc);
        g_hglrc = nullptr;
    }
    if (g_hdc && g_dummyWindow) {
        ReleaseDC(g_dummyWindow, g_hdc);
        g_hdc = nullptr;
    }
    if (g_dummyWindow) {
        DestroyWindow(g_dummyWindow);
        g_dummyWindow = nullptr;
    }
}
#endif

#ifdef __APPLE__
static CGLContextObj g_cglContext = nullptr;
static CGLPixelFormatObj g_cglPixelFormat = nullptr;

static bool createMacOSGLContext() {
    // Create a minimal OpenGL context for offscreen rendering
    CGLPixelFormatAttribute attributes[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
        kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
        kCGLPFAAccelerated,
        kCGLPFANoRecovery,
        (CGLPixelFormatAttribute)0
    };

    GLint numFormats = 0;
    CGLError err = CGLChoosePixelFormat(attributes, &g_cglPixelFormat, &numFormats);
    if (err != kCGLNoError || numFormats == 0) {
        std::cerr << "[MpvContext] Failed to choose pixel format: " << err << std::endl;
        return false;
    }

    err = CGLCreateContext(g_cglPixelFormat, nullptr, &g_cglContext);
    if (err != kCGLNoError) {
        std::cerr << "[MpvContext] Failed to create CGL context: " << err << std::endl;
        CGLDestroyPixelFormat(g_cglPixelFormat);
        g_cglPixelFormat = nullptr;
        return false;
    }

    err = CGLSetCurrentContext(g_cglContext);
    if (err != kCGLNoError) {
        std::cerr << "[MpvContext] Failed to set CGL context current: " << err << std::endl;
        CGLDestroyContext(g_cglContext);
        CGLDestroyPixelFormat(g_cglPixelFormat);
        g_cglContext = nullptr;
        g_cglPixelFormat = nullptr;
        return false;
    }

    std::cout << "[MpvContext] macOS CGL context created successfully" << std::endl;
    return true;
}

static void destroyMacOSGLContext() {
    if (g_cglContext) {
        CGLSetCurrentContext(nullptr);
        CGLDestroyContext(g_cglContext);
        g_cglContext = nullptr;
    }
    if (g_cglPixelFormat) {
        CGLDestroyPixelFormat(g_cglPixelFormat);
        g_cglPixelFormat = nullptr;
    }
}
#endif

#endif // BOXPLAYER_MPV_HEADLESS

bool MpvContext::create(const MpvConfig& config) {
    if (m_initialized) {
        return true;
    }

    m_config = config;

#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
    if (!config.headless) {
#ifdef _WIN32
    // Create Windows GL context first (required for WGL extensions)
    if (!createWindowsGLContext()) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create Windows GL context");
        }
        return false;
    }
    m_glContext = static_cast<void*>(g_hglrc);
#elif defined(__APPLE__)
    // Create macOS CGL context for IOSurface sharing
    if (!createMacOSGLContext()) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create macOS GL context");
        }
        return false;
    }
    m_glContext = static_cast<void*>(g_cglContext);
#endif
    }
#endif

    // Create mpv handle
    m_mpv = mpv_create();
    if (!m_mpv) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create mpv context");
        }
        return false;
    }

    // Set options before initialization
    mpv_set_option_string(m_mpv, "vo", config.headless ? "null" : config.vo.c_str());
    mpv_set_option_string(m_mpv, "hwdec", config.hwdec.c_str());
    mpv_set_option_string(m_mpv, "keep-open", "yes");
    mpv_set_option_string(m_mpv, "idle", "yes");
    mpv_set_option_string(m_mpv, "terminal", "no");
    mpv_set_option_string(m_mpv, "msg-level", "all=v");
    if (const char* audioOutput = std::getenv("BOXPLAYER_MPV_AUDIO_OUTPUT")) {
        if (*audioOutput) mpv_set_option_string(m_mpv, "ao", audioOutput);
    }

    // Initialize mpv
    if (mpv_initialize(m_mpv) < 0) {
        if (m_errorCallback) {
            m_errorCallback("Failed to initialize mpv");
        }
        mpv_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

#ifdef BOXPLAYER_MPV_SOFTWARE
    if (!config.headless) {
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_SW)},
            {MPV_RENDER_PARAM_INVALID, nullptr}
        };
        if (mpv_render_context_create(&m_renderCtx, m_mpv, params) < 0) {
            mpv_terminate_destroy(m_mpv);
            m_mpv = nullptr;
            return false;
        }
        mpv_render_context_set_update_callback(m_renderCtx, renderUpdateCallback, this);
    }
#elif !defined(BOXPLAYER_MPV_HEADLESS)
    if (!config.headless) {
    // Create texture sharing
    m_textureShare = createTextureShare();
    if (!m_textureShare) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create texture share");
        }
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Initialize texture sharing with current GL context
    // Note: The GL context must be created and made current before calling this
    if (!m_textureShare->initialize(m_glContext)) {
        if (m_errorCallback) {
            m_errorCallback("Failed to initialize texture sharing");
        }
        delete m_textureShare;
        m_textureShare = nullptr;
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create shared texture
    if (!m_textureShare->createTexture(config.width, config.height)) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create shared texture");
        }
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Create render context
    mpv_opengl_init_params gl_init_params{};
    gl_init_params.get_proc_address = getProcAddress;
    gl_init_params.get_proc_address_ctx = this;

    int advanced_control = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params},
        {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced_control},
        {MPV_RENDER_PARAM_INVALID, nullptr}
    };

    if (mpv_render_context_create(&m_renderCtx, m_mpv, params) < 0) {
        if (m_errorCallback) {
            m_errorCallback("Failed to create mpv render context");
        }
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
        return false;
    }

    // Set up render update callback
    mpv_render_context_set_update_callback(m_renderCtx, renderUpdateCallback, this);
    }
#endif

    // Set up wakeup callback for event handling
    mpv_set_wakeup_callback(m_mpv, wakeupCallback, this);

    // Observe properties
    mpv_observe_property(m_mpv, 1, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 2, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 3, "mute", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 4, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 5, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 6, "width", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 7, "height", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 8, "speed", MPV_FORMAT_DOUBLE);
    // The Linux renderer runs libmpv in an isolated child process. Notify the
    // parent whenever tracks are discovered, added, or selected so its cached
    // track list cannot remain at the pre-load empty value.
    mpv_observe_property(m_mpv, 9, "track-list", MPV_FORMAT_NONE);

    // Start threads
    m_running = true;
    m_eventThread = std::thread(&MpvContext::eventLoop, this);

#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
#ifdef _WIN32
    // Release GL context from main thread so render thread can use it
    // (OpenGL contexts can only be current on one thread at a time)
    wglMakeCurrent(nullptr, nullptr);
#elif defined(__APPLE__)
    // Release CGL context from main thread so render thread can use it
    CGLSetCurrentContext(nullptr);
#endif

#endif
    if (!config.headless && m_renderCtx) m_renderThread = std::thread(&MpvContext::renderLoop, this);

    m_initialized = true;
    return true;
}

void MpvContext::destroy() {
    if (!m_initialized) {
        return;
    }

    m_running = false;
    m_needsRender = true;
    m_renderCV.notify_one();

    // Stop mpv first to unblock event loop
    if (m_mpv) {
        mpv_wakeup(m_mpv);
    }

    if (m_eventThread.joinable()) {
        m_eventThread.join();
    }

    if (m_renderThread.joinable()) {
        m_renderThread.join();
    }

    if (m_renderCtx) {
        mpv_render_context_free(m_renderCtx);
        m_renderCtx = nullptr;
    }

    if (m_mpv) {
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
    }

    if (m_textureShare) {
        m_textureShare->destroy();
        delete m_textureShare;
        m_textureShare = nullptr;
    }

#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
#ifdef _WIN32
    destroyWindowsGLContext();
    m_glContext = nullptr;
#elif defined(__APPLE__)
    destroyMacOSGLContext();
    m_glContext = nullptr;
#endif
#endif

    m_initialized = false;
}

bool MpvContext::load(const std::string& url, const std::string& options) {
    if (!m_mpv) return false;

    if (!options.empty()) {
        const char* cmd[] = {"loadfile", url.c_str(), "replace", "-1", options.c_str(), nullptr};
        int result = mpv_command(m_mpv, cmd);
        return result >= 0;
    }
    const char* cmd[] = {"loadfile", url.c_str(), nullptr};
    int result = mpv_command(m_mpv, cmd);
    return result >= 0;
}

void MpvContext::play() {
    if (!m_mpv) return;
    int flag = 0;
    if (mpv_set_property(m_mpv, "pause", MPV_FORMAT_FLAG, &flag) >= 0) {
        std::lock_guard<std::mutex> lock(m_statusMutex);
        m_status.playing = true;
    }
}

void MpvContext::pause() {
    if (!m_mpv) return;
    int flag = 1;
    if (mpv_set_property(m_mpv, "pause", MPV_FORMAT_FLAG, &flag) >= 0) {
        std::lock_guard<std::mutex> lock(m_statusMutex);
        m_status.playing = false;
    }
}

void MpvContext::stop() {
    if (!m_mpv) return;
    const char* cmd[] = {"stop", nullptr};
    mpv_command(m_mpv, cmd);
}

void MpvContext::seek(double position) {
    if (!m_mpv) return;
    std::string pos_str = std::to_string(position);
    const char* cmd[] = {"seek", pos_str.c_str(), "absolute", nullptr};
    mpv_command(m_mpv, cmd);
}

void MpvContext::setVolume(double volume) {
    if (!m_mpv) return;
    mpv_set_property(m_mpv, "volume", MPV_FORMAT_DOUBLE, &volume);
}

void MpvContext::setSpeed(double speed) {
    if (!m_mpv || speed < 0.25 || speed > 4.0) return;
    mpv_set_property(m_mpv, "speed", MPV_FORMAT_DOUBLE, &speed);
}

void MpvContext::setAudioTrack(int id) {
    if (!m_mpv) return;
    if (id < 0) {
        mpv_set_property_string(m_mpv, "aid", "no");
        return;
    }
    std::string value = std::to_string(id);
    mpv_set_property_string(m_mpv, "aid", value.c_str());
}

void MpvContext::setSubtitleTrack(int id) {
    if (!m_mpv) return;
    if (id < 0) {
        mpv_set_property_string(m_mpv, "sid", "no");
        return;
    }
    std::string value = std::to_string(id);
    mpv_set_property_string(m_mpv, "sid", value.c_str());
}

void MpvContext::setSubtitleStyle(const MpvSubtitleStyle& style) {
    if (!m_mpv) return;
    if (style.fontSize > 0) {
        std::string value = std::to_string(style.fontSize);
        mpv_set_property_string(m_mpv, "sub-font-size", value.c_str());
    }
    if (!style.color.empty()) {
        mpv_set_property_string(m_mpv, "sub-color", style.color.c_str());
    }
    if (style.position >= 0) {
        std::string value = std::to_string(style.position);
        mpv_set_property_string(m_mpv, "sub-pos", value.c_str());
    }
    mpv_set_property_string(m_mpv, "sub-bold", style.bold ? "yes" : "no");
  mpv_set_property_string(m_mpv, "sub-italic", style.italic ? "yes" : "no");
}

void MpvContext::setVideoProperty(const std::string& name, const std::string& value) {
    if (!m_mpv || name.empty()) return;

    // Keep this surface limited to documented video properties exposed by the UI.
    static const char* allowed[] = {
        "video-aspect-override", "video-crop", "video-rotate", "speed",
        "hwdec", "deinterlace", "tone-mapping", "brightness", "contrast",
        "saturation", "gamma", "hue", "audio-delay", "af", "sub-delay",
        "sub-scale", "sub-pos", "sub-font-size", "sub-color", "sub-border-color",
        "sub-border-size", "sub-back-color", "sub-font", "secondary-sid"
    };
    bool supported = false;
    for (const char* property : allowed) {
        if (name == property) {
            supported = true;
            break;
        }
    }
    if (!supported) return;
    mpv_set_property_string(m_mpv, name.c_str(), value.c_str());
}

bool MpvContext::addAudio(const std::string& url, const std::string& title) {
    if (!m_mpv || url.empty()) return false;
    const char* cmd[] = {
        "audio-add",
        url.c_str(),
        "select",
        title.empty() ? nullptr : title.c_str(),
        nullptr
    };
    // The renderer returns the updated track list with the control response.
    // `mpv_command_async` only confirms that the command was queued, which
    // races that response on Windows/Linux and leaves the audio selector with
    // its stale pre-add list. Execute the command synchronously so callers can
    // immediately observe (and select) the new external track.
    return mpv_command(m_mpv, cmd) >= 0;
}

bool MpvContext::addSubtitle(const std::string& url, const std::string& title) {
    if (!m_mpv || url.empty()) return false;

    const char* cmd[] = {
        "sub-add",
        url.c_str(),
        "select",
        title.empty() ? nullptr : title.c_str(),
        nullptr
    };
    return mpv_command(m_mpv, cmd) >= 0;
}

MpvTrackStatus MpvContext::getTrackStatus() const {
    MpvTrackStatus status;
    if (!m_mpv) return status;

    int64_t aid = -1;
    if (mpv_get_property(m_mpv, "aid", MPV_FORMAT_INT64, &aid) >= 0) status.audioId = static_cast<int>(aid);

    int64_t sid = -1;
    if (mpv_get_property(m_mpv, "sid", MPV_FORMAT_INT64, &sid) >= 0) status.subtitleId = static_cast<int>(sid);

    // `track-list/N/property` is accepted by some libmpv builds but is not a
    // portable client-API property path. In particular, the Linux builds used
    // by BoxPlayer returned an empty list even though the file contained audio
    // and subtitle tracks. Read the documented node-array value instead so the
    // same enumeration works on macOS, Windows and Linux.
    mpv_node trackList{};
    if (mpv_get_property(m_mpv, "track-list", MPV_FORMAT_NODE, &trackList) < 0) return status;

    auto mapValue = [](const mpv_node& map, const char* key) -> const mpv_node* {
        if (map.format != MPV_FORMAT_NODE_MAP || !map.u.list) return nullptr;
        const mpv_node_list* values = map.u.list;
        for (int index = 0; index < values->num; ++index) {
            if (values->keys[index] && std::strcmp(values->keys[index], key) == 0) return &values->values[index];
        }
        return nullptr;
    };
    auto nodeString = [](const mpv_node* value) -> std::string {
        return value && value->format == MPV_FORMAT_STRING && value->u.string ? value->u.string : "";
    };
    auto nodeFlag = [](const mpv_node* value) -> bool {
        return value && value->format == MPV_FORMAT_FLAG && value->u.flag != 0;
    };

    if (trackList.format == MPV_FORMAT_NODE_ARRAY && trackList.u.list) {
        const mpv_node_list* values = trackList.u.list;
        for (int index = 0; index < values->num; ++index) {
            const mpv_node& item = values->values[index];
            const mpv_node* id = mapValue(item, "id");
            const mpv_node* type = mapValue(item, "type");
            if (!id || id->format != MPV_FORMAT_INT64 || !type) continue;

            MpvTrack track{};
            track.id = static_cast<int>(id->u.int64);
            track.type = nodeString(type);
            track.title = nodeString(mapValue(item, "title"));
            track.language = nodeString(mapValue(item, "lang"));
            track.codec = nodeString(mapValue(item, "codec"));
            track.selected = nodeFlag(mapValue(item, "selected"));
            track.external = nodeFlag(mapValue(item, "external"));
            if (track.id >= 0 && !track.type.empty()) status.tracks.push_back(track);
        }
    }
    mpv_free_node_contents(&trackList);
    return status;
}

void MpvContext::toggleMute() {
    if (!m_mpv) return;
    const char* cmd[] = {"cycle", "mute", nullptr};
    mpv_command(m_mpv, cmd);
}

void MpvContext::setFrameCallback(FrameCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_frameCallback = std::move(callback);
}

void MpvContext::setStatusCallback(StatusCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_statusCallback = std::move(callback);
}

void MpvContext::setErrorCallback(ErrorCallback callback) {
    std::lock_guard<std::mutex> lock(m_callbackMutex);
    m_errorCallback = std::move(callback);
}

void MpvContext::releaseFrame() {
    std::lock_guard<std::mutex> lock(m_frameMutex);
    if (m_frameInUse && m_textureShare) {
        m_textureShare->releaseTexture();
        m_frameInUse = false;
    }
}

MpvStatus MpvContext::getStatus() const {
    std::lock_guard<std::mutex> lock(m_statusMutex);
    return m_status;
}

void MpvContext::eventLoop() {
    while (m_running) {
        mpv_event* event = mpv_wait_event(m_mpv, 0.1);
        if (event->event_id == MPV_EVENT_NONE) {
            continue;
        }
        if (event->event_id == MPV_EVENT_SHUTDOWN) {
            break;
        }
        handleEvent(event);
    }
}

void MpvContext::handleEvent(mpv_event* event) {
    switch (event->event_id) {
        case MPV_EVENT_PROPERTY_CHANGE:
            handlePropertyChange(static_cast<mpv_event_property*>(event->data));
            break;
        case MPV_EVENT_END_FILE: {
            auto* end_file = static_cast<mpv_event_end_file*>(event->data);
            if (end_file->reason == MPV_END_FILE_REASON_ERROR) {
                std::lock_guard<std::mutex> lock(m_callbackMutex);
                if (m_errorCallback) {
                    m_errorCallback("Playback error: " + std::string(mpv_error_string(end_file->error)));
                }
            }
            break;
        }
        case MPV_EVENT_LOG_MESSAGE: {
            auto* msg = static_cast<mpv_event_log_message*>(event->data);
            // Only report errors
            if (msg->log_level <= MPV_LOG_LEVEL_ERROR) {
                std::lock_guard<std::mutex> lock(m_callbackMutex);
                if (m_errorCallback) {
                    m_errorCallback(std::string(msg->prefix) + ": " + msg->text);
                }
            }
            break;
        }
        default:
            break;
    }
}

void MpvContext::handlePropertyChange(mpv_event_property* prop) {
    bool statusChanged = false;

    {
        std::lock_guard<std::mutex> lock(m_statusMutex);

        if (strcmp(prop->name, "pause") == 0 && prop->format == MPV_FORMAT_FLAG) {
            m_status.playing = !(*static_cast<int*>(prop->data));
            statusChanged = true;
        } else if (strcmp(prop->name, "volume") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.volume = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "speed") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.speed = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "mute") == 0 && prop->format == MPV_FORMAT_FLAG) {
            m_status.muted = *static_cast<int*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "time-pos") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.position = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "duration") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.duration = *static_cast<double*>(prop->data);
            statusChanged = true;
        } else if (strcmp(prop->name, "width") == 0 && prop->format == MPV_FORMAT_INT64) {
            int newWidth = static_cast<int>(*static_cast<int64_t*>(prop->data));
            if (newWidth > 0 && newWidth != m_status.width) {
                m_status.width = newWidth;
                // Signal render thread to resize (GL calls must happen there)
                if (m_status.height > 0 && m_renderCtx) {
                    m_pendingWidth = static_cast<uint32_t>(m_status.width);
                    m_pendingHeight = static_cast<uint32_t>(m_status.height);
                    m_needsResize = true;
                    m_renderCV.notify_one();  // Wake render thread for resize
                }
            }
            statusChanged = true;
        } else if (strcmp(prop->name, "height") == 0 && prop->format == MPV_FORMAT_INT64) {
            int newHeight = static_cast<int>(*static_cast<int64_t*>(prop->data));
            if (newHeight > 0 && newHeight != m_status.height) {
                m_status.height = newHeight;
                // Signal render thread to resize (GL calls must happen there)
                if (m_status.width > 0 && m_renderCtx) {
                    m_pendingWidth = static_cast<uint32_t>(m_status.width);
                    m_pendingHeight = static_cast<uint32_t>(m_status.height);
                    m_needsResize = true;
                    m_renderCV.notify_one();  // Wake render thread for resize
                }
            }
            statusChanged = true;
        } else if (strcmp(prop->name, "track-list") == 0) {
            statusChanged = true;
        }
    }

    if (statusChanged) {
        // Copy status under its own lock, then release before acquiring callback lock.
        // This avoids nested m_callbackMutex → m_statusMutex ordering that could
        // deadlock if any other code path ever locks them in the opposite order.
        MpvStatus statusCopy;
        {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            statusCopy = m_status;
        }
        std::lock_guard<std::mutex> lock(m_callbackMutex);
        if (m_statusCallback) {
            m_statusCallback(statusCopy);
        }
    }
}

#ifdef BOXPLAYER_MPV_SOFTWARE
void MpvContext::renderLoop() {
    auto lastFrame = std::chrono::steady_clock::time_point::min();
    while (m_running) {
        {
            std::unique_lock<std::mutex> lock(m_renderMutex);
            m_renderCV.wait(lock, [this] { return m_needsRender || !m_running; });
            if (!m_running) break;
            m_needsRender = false;
        }
        if (!(mpv_render_context_update(m_renderCtx) & MPV_RENDER_UPDATE_FRAME)) continue;
        const auto now = std::chrono::steady_clock::now();
        if (lastFrame != std::chrono::steady_clock::time_point::min() &&
            now - lastFrame < std::chrono::milliseconds(50)) continue;
        lastFrame = now;

        int width, height;
        {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            width = m_status.width > 0 ? m_status.width : static_cast<int>(m_config.width);
            height = m_status.height > 0 ? m_status.height : static_cast<int>(m_config.height);
        }
        // Software rendering is a compatibility path, not a full-resolution
        // replacement for platform GPU texture sharing. Bound IPC frame size.
        if (width <= 0 || height <= 0) continue;
        if (width > 1280) {
            height = static_cast<int>(static_cast<int64_t>(height) * 1280 / width);
            width = 1280;
        }
        if (height > 720) {
            width = static_cast<int>(static_cast<int64_t>(width) * 720 / height);
            height = 720;
        }
        width = std::max(width, 1);
        height = std::max(height, 1);
        auto pixels = std::make_shared<std::vector<uint8_t>>(static_cast<size_t>(width) * height * 4);
        int size[2] = {width, height};
        size_t stride = static_cast<size_t>(width) * 4;
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_SW_SIZE, size},
            {MPV_RENDER_PARAM_SW_FORMAT, const_cast<char*>("rgb0")},
            {MPV_RENDER_PARAM_SW_STRIDE, &stride},
            {MPV_RENDER_PARAM_SW_POINTER, pixels->data()},
            {MPV_RENDER_PARAM_INVALID, nullptr}
        };
        if (mpv_render_context_render(m_renderCtx, params) < 0) continue;
        mpv_render_context_report_swap(m_renderCtx);
        for (size_t i = 3; i < pixels->size(); i += 4) (*pixels)[i] = 255;
        TextureInfo frame{};
        frame.width = static_cast<uint32_t>(width);
        frame.height = static_cast<uint32_t>(height);
        frame.format = TextureFormat::RGBA8;
        frame.is_valid = true;
        frame.pixels = pixels;
        std::lock_guard<std::mutex> lock(m_callbackMutex);
        if (m_frameCallback) m_frameCallback(frame);
    }
}

void MpvContext::onRenderUpdate() {
    m_needsRender = true;
    m_renderCV.notify_one();
}

void* MpvContext::getProcAddress(void*, const char*) { return nullptr; }

void MpvContext::renderUpdateCallback(void* ctx) {
    static_cast<MpvContext*>(ctx)->onRenderUpdate();
}
#elif !defined(BOXPLAYER_MPV_HEADLESS)
void MpvContext::renderLoop() {
#ifdef _WIN32
    // Make GL context current on this thread (required for WGL operations)
    if (g_hdc && g_hglrc) {
        if (!wglMakeCurrent(g_hdc, g_hglrc)) {
            std::cerr << "[MpvContext] Failed to make GL context current in render thread" << std::endl;
            std::lock_guard<std::mutex> lock(m_callbackMutex);
            if (m_errorCallback) {
                m_errorCallback("Render thread failed: could not make GL context current");
            }
            return;
        }
        std::cout << "[MpvContext] GL context made current in render thread" << std::endl;
    }
#elif defined(__APPLE__)
    // Make CGL context current on this thread
    if (g_cglContext) {
        CGLError err = CGLSetCurrentContext(g_cglContext);
        if (err != kCGLNoError) {
            std::cerr << "[MpvContext] Failed to make CGL context current in render thread: " << err << std::endl;
            std::lock_guard<std::mutex> lock(m_callbackMutex);
            if (m_errorCallback) {
                m_errorCallback("Render thread failed: could not make CGL context current");
            }
            return;
        }
        std::cout << "[MpvContext] CGL context made current in render thread" << std::endl;
    }
#endif

    while (m_running) {
        // Wait for render update or resize request
        {
            std::unique_lock<std::mutex> lock(m_renderMutex);
            m_renderCV.wait(lock, [this] { return m_needsRender || m_needsResize || !m_running; });
            if (!m_running) break;
            m_needsRender = false;
        }

        // Handle texture resize on render thread (GL context is current here)
        if (m_needsResize && m_textureShare) {
            uint32_t newWidth = m_pendingWidth.load();
            uint32_t newHeight = m_pendingHeight.load();
            if (newWidth > 0 && newHeight > 0) {
                std::cout << "[MpvContext] Resizing texture to " << newWidth << "x" << newHeight << std::endl;
                m_textureShare->resizeTexture(newWidth, newHeight);
            }
            m_needsResize = false;
        }

        // Check if we can render
        uint64_t flags = mpv_render_context_update(m_renderCtx);
        if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
            continue;
        }

        // No m_frameInUse check needed — triple buffering eliminates contention.
        // macOS: IOSurface uses glFlush for GPU-to-GPU sync.
        // Windows (future): keyed mutex / AcquireSync will handle sync instead.

        // Lock texture for rendering
        if (!m_textureShare->lockTexture()) {
            static int lockFailCount = 0;
            if (lockFailCount < 5) {
                std::cout << "[MpvContext] Failed to lock texture" << std::endl;
                lockFailCount++;
            }
            continue;
        }

        // Get FBO and dimensions
        int fbo = m_textureShare->getGLFBO();
        int width, height;
        {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            width = m_status.width > 0 ? m_status.width : m_config.width;
            height = m_status.height > 0 ? m_status.height : m_config.height;
        }

        // Render
        mpv_opengl_fbo fbo_params{};
        fbo_params.fbo = fbo;
        fbo_params.w = width;
        fbo_params.h = height;
        fbo_params.internal_format = 0;

        int flip_y = 1;
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &fbo_params},
            {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
            {MPV_RENDER_PARAM_INVALID, nullptr}
        };

        int result = mpv_render_context_render(m_renderCtx, params);
        if (result < 0) {
            m_textureShare->releaseTexture();
            continue;
        }

        // Report swap
        mpv_render_context_report_swap(m_renderCtx);

        // Flush GL commands to ensure rendering is complete before export.
        // macOS: glFlush is sufficient for GPU-to-GPU IOSurface sharing.
        glFlush();

        // Unlock and export texture
        TextureInfo info = m_textureShare->unlockAndExport();
        if (info.is_valid) {
            static int frameCount = 0;
            if (frameCount < 10) {
                std::cout << "[MpvContext] Frame " << frameCount << " exported: "
                          << info.width << "x" << info.height << std::endl;
            }
            frameCount++;

            std::lock_guard<std::mutex> lock(m_frameMutex);
            m_currentFrame = info;
            m_frameInUse = true;

            // Notify callback
            std::lock_guard<std::mutex> cbLock(m_callbackMutex);
            if (m_frameCallback) {
                m_frameCallback(info);
            }
        }
    }
}

void MpvContext::onRenderUpdate() {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    m_needsRender = true;
    m_renderCV.notify_one();
}

void* MpvContext::getProcAddress(void* ctx, const char* name) {
    (void)ctx; // Unused for now

#ifdef _WIN32
    void* addr = reinterpret_cast<void*>(wglGetProcAddress(name));
    if (!addr) {
        // Try loading from opengl32.dll for core functions
        static HMODULE gl = LoadLibraryA("opengl32.dll");
        if (gl) {
            addr = reinterpret_cast<void*>(GetProcAddress(gl, name));
        }
    }
    return addr;
#elif defined(__APPLE__)
    return dlsym(RTLD_DEFAULT, name);
#else
    return reinterpret_cast<void*>(glXGetProcAddressARB(reinterpret_cast<const GLubyte*>(name)));
#endif
}

void MpvContext::renderUpdateCallback(void* ctx) {
    auto* self = static_cast<MpvContext*>(ctx);
    self->onRenderUpdate();
}
#endif

void MpvContext::wakeupCallback(void* ctx) {
    (void)ctx; // Event loop uses mpv_wait_event with timeout, so no explicit wakeup needed
}

} // namespace mpv_texture
