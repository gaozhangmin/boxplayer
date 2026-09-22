/*
 * N-API addon entry point for mpv-texture
 */

#include <napi.h>
#include <cmath>
#include "mpv_context.h"

// Request high-performance GPU on Windows (NVIDIA Optimus / AMD PowerXpress)
// These exports tell the GPU scheduler to prefer the discrete GPU
#ifdef _WIN32
extern "C" {
    __declspec(dllexport) unsigned long NvOptimusEnablement = 1;
    __declspec(dllexport) int AmdPowerXpressRequestHighPerformance = 1;
}
#endif

using namespace mpv_texture;

// Global context (single instance per process)
static MpvContext* g_context = nullptr;

// Thread-safe function references for callbacks
static Napi::ThreadSafeFunction g_frameCallback;
static Napi::ThreadSafeFunction g_statusCallback;
static Napi::ThreadSafeFunction g_errorCallback;

// Convert TextureInfo to JS object
Napi::Object TextureInfoToJS(Napi::Env env, const TextureInfo& info) {
    auto obj = Napi::Object::New(env);
    obj.Set("handle", Napi::BigInt::New(env, info.handle));
    obj.Set("width", Napi::Number::New(env, info.width));
    obj.Set("height", Napi::Number::New(env, info.height));

    const char* formatStr = "rgba";
    switch (info.format) {
        case TextureFormat::NV12: formatStr = "nv12"; break;
        case TextureFormat::BGRA8: formatStr = "bgra"; break;
        default: formatStr = "rgba"; break;
    }
    obj.Set("format", Napi::String::New(env, formatStr));
    if (info.pixels && !info.pixels->empty()) {
        obj.Set("pixels", Napi::Buffer<uint8_t>::Copy(env, info.pixels->data(), info.pixels->size()));
    }

    return obj;
}

// Convert MpvStatus to JS object
Napi::Object StatusToJS(Napi::Env env, const MpvStatus& status) {
    auto obj = Napi::Object::New(env);
    obj.Set("playing", Napi::Boolean::New(env, status.playing));
    obj.Set("volume", Napi::Number::New(env, status.volume));
    obj.Set("speed", Napi::Number::New(env, status.speed));
    obj.Set("muted", Napi::Boolean::New(env, status.muted));
    obj.Set("position", Napi::Number::New(env, status.position));
    obj.Set("duration", Napi::Number::New(env, status.duration));
    obj.Set("width", Napi::Number::New(env, status.width));
    obj.Set("height", Napi::Number::New(env, status.height));
    return obj;
}

Napi::Object TrackStatusToJS(Napi::Env env, const MpvTrackStatus& status) {
    auto obj = Napi::Object::New(env);
    obj.Set("audioId", Napi::Number::New(env, status.audioId));
    obj.Set("subtitleId", Napi::Number::New(env, status.subtitleId));
    auto tracks = Napi::Array::New(env, status.tracks.size());
    for (size_t i = 0; i < status.tracks.size(); ++i) {
        const auto& track = status.tracks[i];
        auto item = Napi::Object::New(env);
        item.Set("id", Napi::Number::New(env, track.id));
        item.Set("type", Napi::String::New(env, track.type));
        item.Set("title", Napi::String::New(env, track.title));
        item.Set("language", Napi::String::New(env, track.language));
        item.Set("codec", Napi::String::New(env, track.codec));
        item.Set("selected", Napi::Boolean::New(env, track.selected));
        item.Set("external", Napi::Boolean::New(env, track.external));
        tracks.Set(i, item);
    }
    obj.Set("tracks", tracks);
    return obj;
}

// Create the mpv context
Napi::Value Create(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_context) {
        Napi::TypeError::New(env, "Context already created").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    MpvConfig config;

    if (info.Length() > 0 && info[0].IsObject()) {
        auto configObj = info[0].As<Napi::Object>();

        if (configObj.Has("width")) {
            config.width = configObj.Get("width").As<Napi::Number>().Uint32Value();
        }
        if (configObj.Has("height")) {
            config.height = configObj.Get("height").As<Napi::Number>().Uint32Value();
        }
        if (configObj.Has("hwdec")) {
            config.hwdec = configObj.Get("hwdec").As<Napi::String>().Utf8Value();
        }
        if (configObj.Has("headless")) {
            config.headless = configObj.Get("headless").As<Napi::Boolean>().Value();
        }
    }

#if !defined(__APPLE__) && !defined(BOXPLAYER_MPV_SOFTWARE)
    // Windows/Linux currently provide libmpv controls only; texture import is
    // deliberately deferred until the platform-specific renderer is ready.
    config.headless = true;
#endif

    g_context = new MpvContext();

    if (!g_context->create(config)) {
        delete g_context;
        g_context = nullptr;
        Napi::Error::New(env, "Failed to create mpv context").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return env.Undefined();
}

// Destroy the context
Napi::Value Destroy(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_context) {
        g_context->destroy();
        delete g_context;
        g_context = nullptr;
    }

    // Release thread-safe functions
    if (g_frameCallback) {
        g_frameCallback.Release();
    }
    if (g_statusCallback) {
        g_statusCallback.Release();
    }
    if (g_errorCallback) {
        g_errorCallback.Release();
    }

    return env.Undefined();
}

// Load a URL
Napi::Value Load(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        Napi::Error::New(env, "Context not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "URL string required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string url = info[0].As<Napi::String>().Utf8Value();
    std::string options = info.Length() > 1 && info[1].IsString()
        ? info[1].As<Napi::String>().Utf8Value() : "";

    // Return a promise
    auto deferred = Napi::Promise::Deferred::New(env);

    if (g_context->load(url, options)) {
        deferred.Resolve(env.Undefined());
    } else {
        deferred.Reject(Napi::Error::New(env, "Failed to load URL").Value());
    }

    return deferred.Promise();
}

// Play
Napi::Value Play(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_context) g_context->play();
    return env.Undefined();
}

// Pause
Napi::Value Pause(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_context) g_context->pause();
    return env.Undefined();
}

// Stop
Napi::Value Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_context) g_context->stop();
    return env.Undefined();
}

// Seek
Napi::Value Seek(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) return env.Undefined();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Position number required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    double position = info[0].As<Napi::Number>().DoubleValue();
    g_context->seek(position);

    return env.Undefined();
}

// Set volume
Napi::Value SetVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) return env.Undefined();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Volume number required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    double volume = info[0].As<Napi::Number>().DoubleValue();
    g_context->setVolume(volume);

    return env.Undefined();
}

Napi::Value SetSpeed(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_context) {
        Napi::Error::New(env, "Context not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Speed number required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const double speed = info[0].As<Napi::Number>().DoubleValue();
    if (!std::isfinite(speed) || speed < 0.25 || speed > 4.0) {
        Napi::RangeError::New(env, "Speed must be between 0.25 and 4.0").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    g_context->setSpeed(speed);
    return env.Undefined();
}

Napi::Value SetAudioTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) return env.Undefined();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Audio track id number required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    g_context->setAudioTrack(info[0].As<Napi::Number>().Int32Value());
    return env.Undefined();
}

Napi::Value SetSubtitleTrack(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) return env.Undefined();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Subtitle track id number required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    g_context->setSubtitleTrack(info[0].As<Napi::Number>().Int32Value());
    return env.Undefined();
}

Napi::Value SetSubtitleStyle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) return env.Undefined();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Subtitle style object required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto styleObj = info[0].As<Napi::Object>();
    MpvSubtitleStyle style;
    if (styleObj.Has("fontSize") && styleObj.Get("fontSize").IsNumber()) {
        style.fontSize = styleObj.Get("fontSize").As<Napi::Number>().DoubleValue();
    }
    if (styleObj.Has("color") && styleObj.Get("color").IsString()) {
        style.color = styleObj.Get("color").As<Napi::String>().Utf8Value();
    }
    if (styleObj.Has("position") && styleObj.Get("position").IsNumber()) {
        style.position = styleObj.Get("position").As<Napi::Number>().DoubleValue();
    }
    if (styleObj.Has("bold") && styleObj.Get("bold").IsBoolean()) {
        style.bold = styleObj.Get("bold").As<Napi::Boolean>().Value();
    }
    if (styleObj.Has("italic") && styleObj.Get("italic").IsBoolean()) {
        style.italic = styleObj.Get("italic").As<Napi::Boolean>().Value();
    }
    g_context->setSubtitleStyle(style);
    return env.Undefined();
}

Napi::Value SetVideoProperty(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_context) return env.Undefined();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Video property name and value strings required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    g_context->setVideoProperty(
        info[0].As<Napi::String>().Utf8Value(),
        info[1].As<Napi::String>().Utf8Value()
    );
    return env.Undefined();
}

Napi::Value AddAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_context) return env.Undefined();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Audio URL string required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string url = info[0].As<Napi::String>().Utf8Value();
    std::string title = info.Length() > 1 && info[1].IsString()
        ? info[1].As<Napi::String>().Utf8Value() : "";
    if (!g_context->addAudio(url, title)) {
        Napi::Error::New(env, "Failed to add audio").ThrowAsJavaScriptException();
    }
    return env.Undefined();
}

// Add external subtitle
Napi::Value AddSubtitle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        Napi::Error::New(env, "Context not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Subtitle URL string required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string url = info[0].As<Napi::String>().Utf8Value();
    std::string title = info.Length() > 1 && info[1].IsString()
        ? info[1].As<Napi::String>().Utf8Value() : "";

    if (!g_context->addSubtitle(url, title)) {
        Napi::Error::New(env, "Failed to add subtitle").ThrowAsJavaScriptException();
    }

    return env.Undefined();
}

// Toggle mute
Napi::Value ToggleMute(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_context) g_context->toggleMute();
    return env.Undefined();
}

// Get current status
Napi::Value GetStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        return env.Undefined();
    }

    MpvStatus status = g_context->getStatus();
    return StatusToJS(env, status);
}

Napi::Value GetTrackStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        return env.Undefined();
    }

    return TrackStatusToJS(env, g_context->getTrackStatus());
}

// Set frame callback
Napi::Value OnFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        Napi::Error::New(env, "Context not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Release previous callback if any
    if (g_frameCallback) {
        g_frameCallback.Release();
    }

    // Create thread-safe function
    g_frameCallback = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "FrameCallback",
        2,  // Bound queued frames; software frames can be several MB each.
        1   // Initial thread count
    );

    // Set callback on context
    g_context->setFrameCallback([](const TextureInfo& textureInfo) {
        if (g_frameCallback) {
            auto callback = [textureInfo](Napi::Env env, Napi::Function jsCallback) {
                jsCallback.Call({TextureInfoToJS(env, textureInfo)});
            };
            g_frameCallback.NonBlockingCall(callback);
        }
    });

    return env.Undefined();
}

// Set status callback
Napi::Value OnStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        Napi::Error::New(env, "Context not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Release previous callback if any
    if (g_statusCallback) {
        g_statusCallback.Release();
    }

    // Create thread-safe function
    g_statusCallback = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "StatusCallback",
        0,
        1
    );

    // Set callback on context
    g_context->setStatusCallback([](const MpvStatus& status) {
        if (g_statusCallback) {
            auto callback = [status](Napi::Env env, Napi::Function jsCallback) {
                jsCallback.Call({StatusToJS(env, status)});
            };
            g_statusCallback.NonBlockingCall(callback);
        }
    });

    return env.Undefined();
}

// Set error callback
Napi::Value OnError(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_context) {
        Napi::Error::New(env, "Context not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Release previous callback if any
    if (g_errorCallback) {
        g_errorCallback.Release();
    }

    // Create thread-safe function
    g_errorCallback = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "ErrorCallback",
        0,
        1
    );

    // Set callback on context
    g_context->setErrorCallback([](const std::string& error) {
        if (g_errorCallback) {
            auto callback = [error](Napi::Env env, Napi::Function jsCallback) {
                jsCallback.Call({Napi::String::New(env, error)});
            };
            g_errorCallback.NonBlockingCall(callback);
        }
    });

    return env.Undefined();
}

// Release current frame
Napi::Value ReleaseFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_context) g_context->releaseFrame();
    return env.Undefined();
}

// Check if initialized
Napi::Value IsInitialized(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, g_context && g_context->isInitialized());
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("create", Napi::Function::New(env, Create));
    exports.Set("destroy", Napi::Function::New(env, Destroy));
    exports.Set("load", Napi::Function::New(env, Load));
    exports.Set("play", Napi::Function::New(env, Play));
    exports.Set("pause", Napi::Function::New(env, Pause));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("seek", Napi::Function::New(env, Seek));
    exports.Set("setVolume", Napi::Function::New(env, SetVolume));
    exports.Set("setSpeed", Napi::Function::New(env, SetSpeed));
    exports.Set("setAudioTrack", Napi::Function::New(env, SetAudioTrack));
    exports.Set("setSubtitleTrack", Napi::Function::New(env, SetSubtitleTrack));
    exports.Set("setSubtitleStyle", Napi::Function::New(env, SetSubtitleStyle));
    exports.Set("setVideoProperty", Napi::Function::New(env, SetVideoProperty));
    exports.Set("addAudio", Napi::Function::New(env, AddAudio));
    exports.Set("addSubtitle", Napi::Function::New(env, AddSubtitle));
    exports.Set("toggleMute", Napi::Function::New(env, ToggleMute));
    exports.Set("getStatus", Napi::Function::New(env, GetStatus));
    exports.Set("getTrackStatus", Napi::Function::New(env, GetTrackStatus));
    exports.Set("onFrame", Napi::Function::New(env, OnFrame));
#ifdef BOXPLAYER_MPV_SOFTWARE
    exports.Set("renderMode", Napi::String::New(env, "software"));
#else
    exports.Set("renderMode", Napi::String::New(env, "texture"));
#endif
    exports.Set("onStatus", Napi::Function::New(env, OnStatus));
    exports.Set("onError", Napi::Function::New(env, OnError));
    exports.Set("releaseFrame", Napi::Function::New(env, ReleaseFrame));
    exports.Set("isInitialized", Napi::Function::New(env, IsInitialized));

    return exports;
}

NODE_API_MODULE(mpv_texture, Init)
