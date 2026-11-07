/*
 * libmpv wrapper implementation
 */

#include "mpv_context.h"
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <future>

#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
#ifdef _WIN32
#define NOMINMAX
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
#include <EGL/egl.h>
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
static bool g_softwareCGLFallback = false;

static bool createMacOSGLContext() {
    g_softwareCGLFallback = false;
    // Prefer the accelerated renderer on real Macs. GitHub-hosted and other
    // headless macOS machines do not expose an accelerated pixel format even
    // though CGL's software renderer can still render into IOSurface-backed
    // textures. Falling back here keeps the exact production addon and libmpv
    // path testable without weakening the normal hardware path.
    CGLPixelFormatAttribute acceleratedAttributes[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
        kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
        kCGLPFAAccelerated,
        kCGLPFANoRecovery,
        (CGLPixelFormatAttribute)0
    };

    GLint numFormats = 0;
    CGLError err = CGLChoosePixelFormat(acceleratedAttributes, &g_cglPixelFormat, &numFormats);
    if (err != kCGLNoError || numFormats == 0) {
        if (g_cglPixelFormat) {
            CGLDestroyPixelFormat(g_cglPixelFormat);
            g_cglPixelFormat = nullptr;
        }
        CGLPixelFormatAttribute softwareAttributes[] = {
            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
            kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
            (CGLPixelFormatAttribute)0
        };
        numFormats = 0;
        err = CGLChoosePixelFormat(softwareAttributes, &g_cglPixelFormat, &numFormats);
        if (err == kCGLNoError && numFormats > 0) {
            g_softwareCGLFallback = true;
            std::cout << "[MpvContext] Accelerated CGL pixel format unavailable; using software OpenGL renderer" << std::endl;
        }
    }
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

    if (const char* forceReadback = std::getenv("BOXPLAYER_MPV_FORCE_SOFTWARE_READBACK")) {
        if (strcmp(forceReadback, "1") == 0) g_softwareCGLFallback = true;
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
    g_softwareCGLFallback = false;
}
#endif

#endif // BOXPLAYER_MPV_HEADLESS

bool MpvContext::create(const MpvConfig& config) {
    if (m_initialized) {
        return true;
    }

    m_config = config;

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
    mpv_set_option_string(m_mpv, "msg-level", "all=warn");
    mpv_set_option_string(m_mpv, "network-timeout", "15");
    mpv_set_option_string(m_mpv, "secondary-sub-pos", "96");
    if (const char* audioOutput = std::getenv("BOXPLAYER_MPV_AUDIO_OUTPUT")) {
        if (*audioOutput) mpv_set_option_string(m_mpv, "ao", audioOutput);
    }

    if (!config.fontsDir.empty()) {
        mpv_set_option_string(m_mpv, "sub-fonts-dir", config.fontsDir.c_str());
        mpv_set_option_string(m_mpv, "sub-font", "Noto Sans CJK SC");
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

    // Set up wakeup callback for event handling
    mpv_set_wakeup_callback(m_mpv, wakeupCallback, this);

    // Observe properties
    mpv_observe_property(m_mpv, 1, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 2, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 3, "mute", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 4, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 5, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 105, "demuxer-cache-time", MPV_FORMAT_DOUBLE);
    mpv_observe_property(m_mpv, 6, "width", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 7, "height", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 8, "speed", MPV_FORMAT_DOUBLE);
    // The Linux renderer runs libmpv in an isolated child process. Notify the
    // parent whenever tracks are discovered, added, or selected so its cached
    // track list cannot remain at the pre-load empty value.
    mpv_observe_property(m_mpv, 9, "track-list", MPV_FORMAT_NODE);

    mpv_observe_property(m_mpv, 10, "aid", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 11, "sid", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 14, "secondary-sid", MPV_FORMAT_INT64);
    mpv_observe_property(m_mpv, 15, "secondary-sub-text", MPV_FORMAT_STRING);
    mpv_observe_property(m_mpv, 31, "sub-text", MPV_FORMAT_STRING);
    mpv_observe_property(m_mpv, 12, "paused-for-cache", MPV_FORMAT_FLAG);
    mpv_observe_property(m_mpv, 13, "eof-reached", MPV_FORMAT_FLAG);

    // Start threads
    m_running = true;
    m_eventThread = std::thread(&MpvContext::eventLoop, this);

    if (!config.headless) {
        std::promise<bool> ready;
        auto result = ready.get_future();
        m_renderThread = std::thread([this, &ready] {
            bool initialized = initializeRenderer();
            ready.set_value(initialized);
            if (initialized) {
                if (m_softwareRenderer) renderSoftwareLoop();
                else renderLoop();
            }
            destroyRenderer();
        });
        if (!result.get()) {
            m_running = false;
            mpv_wakeup(m_mpv);
            m_eventThread.join();
            m_renderThread.join();
            mpv_terminate_destroy(m_mpv);
            m_mpv = nullptr;
            return false;
        }
    }

    m_initialized = true;
    return true;
}

void MpvContext::destroy() {
    if (!m_initialized) {
        return;
    }

    m_running = false;
    cancelTrackCommands();
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

    if (m_mpv) {
        mpv_terminate_destroy(m_mpv);
        m_mpv = nullptr;
    }
    m_initialized = false;
}

bool MpvContext::initializeRenderer() {
    bool gpuReady = false;
#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
    const char* forced = std::getenv("BOXPLAYER_MPV_RENDERER");
    if (!forced || std::string(forced) != "software") {
        gpuReady = [&]() -> bool {
#ifdef _WIN32
            if (!createWindowsGLContext()) return false;
            m_glContext = static_cast<void*>(g_hglrc);
#elif defined(__APPLE__)
            if (!createMacOSGLContext()) return false;
            m_glContext = static_cast<void*>(g_cglContext);
#endif
            m_textureShare = createTextureShare();
            if (!m_textureShare) return false;
#ifdef __APPLE__
            m_textureShare->setSoftwareReadback(g_softwareCGLFallback);
#endif
            if (!m_textureShare->initialize(m_glContext)) return false;
            if (!m_textureShare->createTexture(m_config.width, m_config.height)) return false;
            mpv_opengl_init_params glParams{};
            glParams.get_proc_address = getProcAddress;
            glParams.get_proc_address_ctx = this;
            mpv_render_param params[] = {
                {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
                {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glParams},
                {MPV_RENDER_PARAM_INVALID, nullptr}
            };
            if (mpv_render_context_create(&m_renderCtx, m_mpv, params) < 0) return false;
            mpv_render_context_set_update_callback(m_renderCtx, renderUpdateCallback, this);
            return true;
        }();
    }
#endif
    if (gpuReady) return true;
    destroyRenderer();
    m_softwareRenderer = true;
    setProperty("hwdec", "auto-copy");
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_SW)},
        {MPV_RENDER_PARAM_INVALID, nullptr}
    };
    if (mpv_render_context_create(&m_renderCtx, m_mpv, params) < 0) return false;
    mpv_render_context_set_update_callback(m_renderCtx, renderUpdateCallback, this);
    return true;
}

void MpvContext::destroyRenderer() {
#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
#ifdef __APPLE__
    if (g_cglContext) CGLSetCurrentContext(g_cglContext);
#elif defined(_WIN32)
    if (g_hglrc) wglMakeCurrent(g_hdc, g_hglrc);
#endif
#endif
    if (m_renderCtx) {
        mpv_render_context_free(m_renderCtx);
        m_renderCtx = nullptr;
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

 }

bool MpvContext::load(const std::string& url, const std::string& options) {
    if (!m_mpv) return false;
    cancelTrackCommands();
    { std::lock_guard<std::mutex> lock(m_tracksMutex); m_tracks = {}; }
    { std::lock_guard<std::mutex> lock(m_statusMutex);
      m_status.loading = true; m_status.ended = false; m_status.bufferedPosition = 0; m_status.position = 0; m_status.duration = 0; }

    if (!options.empty()) {
        const char* cmd[] = {"loadfile", url.c_str(), "replace", "-1", options.c_str(), nullptr};
        int result = mpv_command_async(m_mpv, 0, cmd);
        return result >= 0;
    }
    const char* cmd[] = {"loadfile", url.c_str(), nullptr};
    int result = mpv_command_async(m_mpv, 0, cmd);
    return result >= 0;
}

void MpvContext::play() {
    if (!m_mpv) return;
    int flag = 0;
    if (mpv_set_property_async(m_mpv, 0, "pause", MPV_FORMAT_FLAG, &flag) >= 0) {
        std::lock_guard<std::mutex> lock(m_statusMutex);
        m_status.playing = true;
    }
}

void MpvContext::pause() {
    if (!m_mpv) return;
    int flag = 1;
    if (mpv_set_property_async(m_mpv, 0, "pause", MPV_FORMAT_FLAG, &flag) >= 0) {
        std::lock_guard<std::mutex> lock(m_statusMutex);
        m_status.playing = false;
    }
}

void MpvContext::stop() {
    if (!m_mpv) return;
    const char* cmd[] = {"stop", nullptr};
    mpv_command_async(m_mpv, 0, cmd);
}

void MpvContext::seek(double position) {
    if (!m_mpv) return;
    std::string pos_str = std::to_string(position);
    const char* cmd[] = {"seek", pos_str.c_str(), "absolute", nullptr};
    mpv_command_async(m_mpv, 0, cmd);
}

void MpvContext::setVolume(double volume) {
    if (!m_mpv) return;
    mpv_set_property_async(m_mpv, 0, "volume", MPV_FORMAT_DOUBLE, &volume);
}

void MpvContext::setSpeed(double speed) {
    if (!m_mpv || speed < 0.25 || speed > 4.0) return;
    mpv_set_property_async(m_mpv, 0, "speed", MPV_FORMAT_DOUBLE, &speed);
}

void MpvContext::setAudioTrack(int id) {
    if (!m_mpv) return;
    if (id < 0) {
        setProperty("aid", "no");
        return;
    }
    std::string value = std::to_string(id);
    setProperty("aid", value.c_str());
}

void MpvContext::setSubtitleTrack(int id) {
    if (!m_mpv) return;
    if (id < 0) {
        setProperty("sid", "no");
        return;
    }
    std::string value = std::to_string(id);
    setProperty("sid", value.c_str());
}

void MpvContext::setSubtitleStyle(const MpvSubtitleStyle& style) {
    if (!m_mpv) return;
    if (style.fontSize > 0) {
        std::string value = std::to_string(style.fontSize);
        setProperty("sub-font-size", value.c_str());
    }
    if (!style.color.empty()) {
        setProperty("sub-color", style.color.c_str());
    }
    if (style.position >= 0) {
        std::string value = std::to_string(style.position);
        setProperty("sub-pos", value.c_str());
    }
    setProperty("sub-bold", style.bold ? "yes" : "no");
  setProperty("sub-italic", style.italic ? "yes" : "no");
}

void MpvContext::setVideoProperty(const std::string& name, const std::string& value) {
    if (!m_mpv || name.empty()) return;

    // Keep this surface limited to documented video properties exposed by the UI.
    static const char* allowed[] = {
        "video-aspect-override", "video-crop", "video-rotate", "speed",
        "hwdec", "deinterlace", "tone-mapping", "brightness", "contrast",
        "saturation", "gamma", "hue", "audio-delay", "af", "sub-delay",
        "sub-scale", "sub-pos", "sub-font-size", "sub-color", "sub-border-color",
        "sub-border-size", "sub-back-color", "sub-font", "secondary-sid", "secondary-sub-pos",
        "sub-visibility", "secondary-sub-visibility", "secondary-sub-delay", "secondary-sub-scale",
        "sub-ass-override", "secondary-sub-ass-override", "sub-shadow-color", "sub-shadow-offset",
        "stretch-image-subs-to-screen", "image-subs-video-resolution"
    };
    bool supported = false;
    for (const char* property : allowed) {
        if (name == property) {
            supported = true;
            break;
        }
    }
    if (!supported) return;
    // libmpv's software render backend can retain a crop rectangle from the
    // previous frame while video-crop/video-rotate reconfigure the source.
    // That upstream path aborts inside mp_image_crop instead of returning an
    // error. Windows/Linux apply these two presentation-only transforms to
    // the received RGBA frame in MpvEmbeddedSurface, while all other video
    // properties continue to be handled by libmpv here.
    if (m_softwareRenderer && (name == "video-crop" || name == "video-rotate")) return;
    // Crop/rotation/aspect and filter changes reconfigure libmpv's render
    // destination. Do not let the software render thread use the previous
    // destination rectangle while the property update is being applied.
    setProperty(name.c_str(), m_softwareRenderer && name == "hwdec" && value == "auto" ? "auto-copy" : value);
}

void MpvContext::addAudio(const std::string& url, const std::string& title, CommandCallback completion) {
    if (!m_mpv || url.empty()) {
        completion(MPV_ERROR_INVALID_PARAMETER);
        return;
    }
    const char* cmd[] = {
        "audio-add",
        url.c_str(),
        "select",
        title.empty() ? nullptr : title.c_str(),
        nullptr
    };
    submitTrackCommand(cmd, std::move(completion));
}

void MpvContext::addSubtitle(const std::string& url, const std::string& title, CommandCallback completion) {
    if (!m_mpv || url.empty()) {
        completion(MPV_ERROR_INVALID_PARAMETER);
        return;
    }

    const char* cmd[] = {
        "sub-add",
        url.c_str(),
        "select",
        title.empty() ? nullptr : title.c_str(),
        nullptr
    };
    submitTrackCommand(cmd, std::move(completion));
}

void MpvContext::submitTrackCommand(const char** command, CommandCallback completion) {
    uint64_t id;
    int result;
    {
        std::lock_guard<std::mutex> commandLock(m_commandMutex);
        id = ++m_nextCommandId;
        m_trackCommands.emplace(id, std::move(completion));
        m_commandDeadlines[id] = std::chrono::steady_clock::now() + std::chrono::seconds(15);
        // sub-add/audio-add can spend seconds opening a URL. A synchronous
        // mpv_command here blocks Electron's Cocoa event loop, including the
        // native close button. Resolve the JS promise only on COMMAND_REPLY.
        result = mpv_command_async(m_mpv, id, command);
    }
    if (result < 0) completeTrackCommand(id, result);
}

void MpvContext::completeTrackCommand(uint64_t id, int error) {
    CommandCallback completion;
    {
        std::lock_guard<std::mutex> lock(m_commandMutex);
        const auto found = m_trackCommands.find(id);
        if (found == m_trackCommands.end()) return;
        completion = std::move(found->second);
        m_trackCommands.erase(found);
        m_commandDeadlines.erase(id);
    }
#ifndef BOXPLAYER_MPV_HEADLESS
    onRenderUpdate();
#endif
    completion(error);
}

void MpvContext::cancelTrackCommands() {
    std::unordered_map<uint64_t, CommandCallback> commands;
    {
        std::lock_guard<std::mutex> lock(m_commandMutex);
        commands.swap(m_trackCommands);
        m_commandDeadlines.clear();
    }
    for (auto& entry : commands) {
        mpv_abort_async_command(m_mpv, entry.first);
        entry.second(MPV_ERROR_UNINITIALIZED);
    }
}

void MpvContext::setProperty(const char* name, const std::string& value) {
    const char* data = value.c_str();
    mpv_set_property_async(m_mpv, 0, name, MPV_FORMAT_STRING, &data);
}

void MpvContext::expireTrackCommands() {
    std::vector<uint64_t> expired;
    {
        std::lock_guard<std::mutex> lock(m_commandMutex);
        for (const auto& item : m_commandDeadlines) {
            if (item.second <= std::chrono::steady_clock::now()) expired.push_back(item.first);
        }
    }
    for (auto id : expired) {
        mpv_abort_async_command(m_mpv, id);
        completeTrackCommand(id, MPV_ERROR_GENERIC);
    }
}

MpvTrackStatus MpvContext::getTrackStatus() const {
    std::lock_guard<std::mutex> lock(m_tracksMutex);
    return m_tracks;
}

void MpvContext::cacheTracks(const mpv_node& trackList) {
    std::lock_guard<std::mutex> lock(m_tracksMutex);
    auto& status = m_tracks;
    status.tracks.clear();
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
            if (track.selected && track.type == "audio") status.audioId = track.id;
            // selected is true for BOTH subtitle slots; preserve each observed sid.
            // The track list alone cannot identify the primary subtitle.
            if (track.id >= 0 && !track.type.empty()) status.tracks.push_back(track);
        }
    }

}

void MpvContext::toggleMute() {
    if (!m_mpv) return;
    const char* cmd[] = {"cycle", "mute", nullptr};
    mpv_command_async(m_mpv, 0, cmd);
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
        expireTrackCommands();
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
        case MPV_EVENT_SET_PROPERTY_REPLY:
        case MPV_EVENT_COMMAND_REPLY:
            if (event->reply_userdata) completeTrackCommand(event->reply_userdata, event->error);
            else if (event->event_id == MPV_EVENT_COMMAND_REPLY && event->error < 0) {
                std::lock_guard<std::mutex> lock(m_callbackMutex);
                if (m_errorCallback) m_errorCallback(mpv_error_string(event->error));
            }
            break;
        case MPV_EVENT_START_FILE: {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            m_status.loading = true;
            m_status.ended = false;
            m_status.bufferedPosition = 0; m_status.position = 0;
            m_status.duration = 0;
            break;
        }
        case MPV_EVENT_FILE_LOADED: {
            std::lock_guard<std::mutex> lock(m_statusMutex);
            m_status.loading = false;
            break;
        }
            break;
        case MPV_EVENT_PROPERTY_CHANGE:
            handlePropertyChange(static_cast<mpv_event_property*>(event->data));
            break;
        case MPV_EVENT_END_FILE: {
            auto* end_file = static_cast<mpv_event_end_file*>(event->data);
            { std::lock_guard<std::mutex> lock(m_statusMutex); m_status.loading = false; }
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
        } else if (strcmp(prop->name, "demuxer-cache-time") == 0 && prop->format == MPV_FORMAT_DOUBLE) {
            m_status.bufferedPosition = *static_cast<double*>(prop->data);
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
        } else if (strcmp(prop->name, "track-list") == 0 && prop->format == MPV_FORMAT_NODE && prop->data) {
            cacheTracks(*static_cast<mpv_node*>(prop->data));
            statusChanged = true;
        } else if (strcmp(prop->name, "sub-text") == 0) {
            const char* text = prop->format == MPV_FORMAT_STRING && prop->data ? *static_cast<char**>(prop->data) : nullptr;
            std::lock_guard<std::mutex> tracksLock(m_tracksMutex);
            const std::string next = text ? text : "";
            statusChanged = m_tracks.subtitleText != next;
            m_tracks.subtitleText = next;
        } else if (strcmp(prop->name, "secondary-sub-text") == 0) {
            const char* text = prop->format == MPV_FORMAT_STRING && prop->data ? *static_cast<char**>(prop->data) : nullptr;
            int lines = text && *text ? 1 + static_cast<int>(std::count(text, text + std::strlen(text), '\n')) : 0;
            std::lock_guard<std::mutex> tracksLock(m_tracksMutex);
            const std::string next = text ? text : "";
            statusChanged = m_tracks.secondarySubtitleLines != lines || m_tracks.secondarySubtitleText != next;
            m_tracks.secondarySubtitleLines = lines;
            m_tracks.secondarySubtitleText = next;
        } else if (strcmp(prop->name, "aid") == 0 || strcmp(prop->name, "sid") == 0 || strcmp(prop->name, "secondary-sid") == 0) {
            std::lock_guard<std::mutex> tracksLock(m_tracksMutex);
            int id = prop->format == MPV_FORMAT_INT64 && prop->data ? static_cast<int>(*static_cast<int64_t*>(prop->data)) : -1;
            if (strcmp(prop->name, "aid") == 0) m_tracks.audioId = id;
            else if (strcmp(prop->name, "sid") == 0) m_tracks.subtitleId = id;
            else m_tracks.secondarySubtitleId = id;
            statusChanged = true;
        } else if (prop->format == MPV_FORMAT_FLAG && prop->data && strcmp(prop->name, "paused-for-cache") == 0) {
            m_status.buffering = *static_cast<int*>(prop->data) != 0;
            statusChanged = true;
        } else if (prop->format == MPV_FORMAT_FLAG && prop->data && strcmp(prop->name, "eof-reached") == 0) {
            m_status.ended = *static_cast<int*>(prop->data) != 0;
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

void MpvContext::renderSoftwareLoop() {
    std::vector<std::shared_ptr<std::vector<uint8_t>>> pool(3);
    while (m_running) {
        {
            std::unique_lock<std::mutex> lock(m_renderMutex);
            m_renderCV.wait(lock, [this] { return m_needsRender || !m_running; });
            if (!m_running) break;
            m_needsRender = false;
        }
        if (!(mpv_render_context_update(m_renderCtx) & MPV_RENDER_UPDATE_FRAME)) continue;
        // Render every frame requested by libmpv. The former 50 ms throttle
        // limited Windows/Linux software presentation to 20 FPS even for
        // 24/30/60 FPS media and skipped render/report_swap for those frames.

        // The software render target must remain stable across source
        // reconfiguration. Properties such as video-crop and video-rotate can
        // change the reported source width/height asynchronously. Feeding
        // those transient dimensions back as the next SW target lets
        // libmpv's previous destination rectangle outlive the target buffer
        // and can trip mp_image_crop's bounds assertion. libmpv already
        // letterboxes/crops the source into the requested target, so keep the
        // configured presentation size fixed and let it own that mapping.
        int width = static_cast<int>(m_config.width);
        int height = static_cast<int>(m_config.height);
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
        std::shared_ptr<std::vector<uint8_t>> pixels;
        for (auto& buffer : pool) {
            if (!buffer) buffer = std::make_shared<std::vector<uint8_t>>();
            if (buffer.use_count() == 1) { pixels = buffer; break; }
        }
        if (!pixels) {
            int skip = 1;
            mpv_render_param params[] = {{MPV_RENDER_PARAM_SKIP_RENDERING, &skip}, {MPV_RENDER_PARAM_INVALID, nullptr}};
            mpv_render_context_render(m_renderCtx, params);
            continue;
        }
        pixels->resize(static_cast<size_t>(width) * height * 4);
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

#if !defined(BOXPLAYER_MPV_HEADLESS) && !defined(BOXPLAYER_MPV_SOFTWARE)
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

    uint32_t targetWidth = m_config.width;
    uint32_t targetHeight = m_config.height;
    while (m_running) {
        // Wait for render update or resize request
        {
            std::unique_lock<std::mutex> lock(m_renderMutex);
            m_renderCV.wait(lock, [this] { return m_needsRender || m_needsResize || !m_running; });
            if (!m_running) break;
            m_needsRender = false;
        }

        if (m_forceReadback && m_textureShare) m_textureShare->setSoftwareReadback(true);

        // Read a consistent source-size snapshot, but render only into the
        // dimensions actually allocated. Property events may arrive mid-frame.
        if (m_needsResize.exchange(false) && m_textureShare) {
            uint32_t newWidth, newHeight;
            {
                std::lock_guard<std::mutex> lock(m_statusMutex);
                newWidth = m_status.width;
                newHeight = m_status.height;
            }
            if (newWidth > 0 && newHeight > 0) {
                if (!m_textureShare->resizeTexture(newWidth, newHeight)) {
                    std::lock_guard<std::mutex> lock(m_callbackMutex);
                    if (m_errorCallback) m_errorCallback("Could not allocate video render target");
                    return;
                }
                targetWidth = newWidth;
                targetHeight = newHeight;
            }
        }

        // Check if we can render
        uint64_t flags = mpv_render_context_update(m_renderCtx);
        if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
            continue;
        }

        // Only slots whose exported leases have been released may be reused.

        // Lock texture for rendering
        if (!m_textureShare->lockTexture()) {
            int skip = 1;
            mpv_render_param skipParams[] = {{MPV_RENDER_PARAM_SKIP_RENDERING, &skip}, {MPV_RENDER_PARAM_INVALID, nullptr}};
            mpv_render_context_render(m_renderCtx, skipParams);
            continue;
        }

        // Get FBO and dimensions
        int fbo = m_textureShare->getGLFBO();
        int width = targetWidth, height = targetHeight;

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

        // Exporters provide the completion fence before handing a texture to Electron.
        glFlush();

        // Unlock and export texture
        TextureInfo info = m_textureShare->unlockAndExport();
        info.transformed = true;
        if (info.is_valid) {
            static int frameCount = 0;
            if (frameCount < 10) {
                std::cout << "[MpvContext] Frame " << frameCount << " exported: "
                          << info.width << "x" << info.height << std::endl;
            }
            frameCount++;

            std::lock_guard<std::mutex> lock(m_frameMutex);


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
    return reinterpret_cast<void*>(eglGetProcAddress(name));
#endif
}

void MpvContext::renderUpdateCallback(void* ctx) {
    auto* self = static_cast<MpvContext*>(ctx);
    self->onRenderUpdate();
}
#else
void MpvContext::renderLoop() { renderSoftwareLoop(); }
void MpvContext::onRenderUpdate() {
    m_needsRender = true;
    m_renderCV.notify_one();
}
void* MpvContext::getProcAddress(void*, const char*) { return nullptr; }
void MpvContext::renderUpdateCallback(void* ctx) { static_cast<MpvContext*>(ctx)->onRenderUpdate(); }
#endif

void MpvContext::wakeupCallback(void* ctx) {
    (void)ctx; // Event loop uses mpv_wait_event with timeout, so no explicit wakeup needed
}

} // namespace mpv_texture
