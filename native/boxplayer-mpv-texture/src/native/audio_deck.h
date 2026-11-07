#pragma once
#include <napi.h>
#include <mpv/client.h>
#include <memory>
#include <utility>
#include <string>
#include <cmath>

// Audio decks deliberately do not use the process-wide texture context. Each
// deck owns a libmpv client, so music crossfades never replace video playback.
struct AudioDeckState {
    mpv_handle* handle = nullptr;
    bool ready = false;
    bool ended = false;
    std::string error;
    void close() { if (handle) { mpv_terminate_destroy(handle); handle = nullptr; } }
    ~AudioDeckState() { close(); }
    double number(const char* name) {
        double value = 0;
        if (handle) mpv_get_property(handle, name, MPV_FORMAT_DOUBLE, &value);
        return std::isfinite(value) ? value : 0;
    }
    bool flag(const char* name) {
        int value = 0;
        if (handle) mpv_get_property(handle, name, MPV_FORMAT_FLAG, &value);
        return value != 0;
    }
    void check(int result, Napi::Env env) {
        if (result < 0) Napi::Error::New(env, mpv_error_string(result)).ThrowAsJavaScriptException();
    }
};

inline Napi::Value CreateAudioDeck(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto state = std::make_shared<AudioDeckState>();
    state->handle = mpv_create();
    if (!state->handle) { Napi::Error::New(env, "Cannot create audio deck").ThrowAsJavaScriptException(); return env.Undefined(); }
    for (const auto& pair : {std::pair<const char*, const char*>{"vid", "no"}, {"sid", "no"},
             {"vo", "null"}, {"idle", "yes"}, {"keep-open", "yes"}, {"pause", "yes"},
             {"config", "no"}, {"input-default-bindings", "no"}, {"input-vo-keyboard", "no"}}) {
        int result = mpv_set_option_string(state->handle, pair.first, pair.second);
        if (result < 0) { state->check(result, env); return env.Undefined(); }
    }
    // Headless lifecycle checks may explicitly request a silent output. Never
    // accept arbitrary libmpv options through this factory.
    if (info.Length() > 0 && info[0].IsObject()) {
        auto output = info[0].As<Napi::Object>().Get("audioOutput");
        if (output.IsString() && output.As<Napi::String>().Utf8Value() == "null")
            mpv_set_option_string(state->handle, "ao", "null");
    }
    int result = mpv_initialize(state->handle);
    if (result < 0) { state->check(result, env); return env.Undefined(); }
    auto deck = Napi::Object::New(env);
    deck.Set("load", Napi::Function::New(env, [state](const Napi::CallbackInfo& call) {
        if (!state->handle) return;
        if (call.Length() < 1 || !call[0].IsString()) { Napi::TypeError::New(call.Env(), "Missing audio URL").ThrowAsJavaScriptException(); return; }
        const std::string url = call[0].As<Napi::String>().Utf8Value();
        const std::string options = call.Length() > 1 ? call[1].ToString().Utf8Value() : "vid=no,sid=no";
        state->ready = false; state->ended = false; state->error.clear();
        const char* args[] = {"loadfile", url.c_str(), "replace", "-1", options.c_str(), nullptr};
        state->check(mpv_command_async(state->handle, 0, args), call.Env());
    }));
    deck.Set("play", Napi::Function::New(env, [state](const Napi::CallbackInfo& call) {
        if (state->handle) state->check(mpv_set_property_string(state->handle, "pause", "no"), call.Env());
    }));
    deck.Set("pause", Napi::Function::New(env, [state](const Napi::CallbackInfo& call) {
        if (state->handle) state->check(mpv_set_property_string(state->handle, "pause", "yes"), call.Env());
    }));
    deck.Set("seek", Napi::Function::New(env, [state](const Napi::CallbackInfo& call) {
        if (!state->handle || !call.Length() || !call[0].IsNumber()) return;
        const double value = call[0].As<Napi::Number>().DoubleValue();
        if (!std::isfinite(value) || value < 0) return;
        std::string position = std::to_string(value);
        const char* args[] = {"seek", position.c_str(), "absolute+exact", nullptr};
        state->check(mpv_command_async(state->handle, 0, args), call.Env());
    }));
    for (const std::string property : {"volume", "speed"}) {
        deck.Set(property == "volume" ? "setVolume" : "setSpeed", Napi::Function::New(env, [state, property](const Napi::CallbackInfo& call) {
            if (!state->handle || !call.Length() || !call[0].IsNumber()) return;
            double value = call[0].As<Napi::Number>().DoubleValue();
            if (!std::isfinite(value)) return;
            if ((property == "volume" && (value < 0 || value > 100)) || (property == "speed" && (value < .25 || value > 4))) return;
            state->check(mpv_set_property(state->handle, property.c_str(), MPV_FORMAT_DOUBLE, &value), call.Env());
        }));
    }
    deck.Set("setVideoProperty", Napi::Function::New(env, [state](const Napi::CallbackInfo& call) {
        if (!state->handle || call.Length() < 2) return;
        std::string property = call[0].ToString().Utf8Value();
        std::string value = call[1].ToString().Utf8Value();
        if (property != "af" && property != "audio-pitch-correction") return;
        state->check(mpv_set_property_string(state->handle, property.c_str(), value.c_str()), call.Env());
    }));
    deck.Set("getStatus", Napi::Function::New(env, [state](const Napi::CallbackInfo& call) {
        auto status = Napi::Object::New(call.Env());
        if (state->handle) {
            while (auto* event = mpv_wait_event(state->handle, 0)) {
                if (event->event_id == MPV_EVENT_NONE) break;
                if (event->event_id == MPV_EVENT_FILE_LOADED) state->ready = true;
                if (event->event_id == MPV_EVENT_COMMAND_REPLY && event->error < 0) state->error = mpv_error_string(event->error);
                if (event->event_id == MPV_EVENT_END_FILE && event->data) {
                    auto* end = static_cast<mpv_event_end_file*>(event->data);
                    if (end->reason == MPV_END_FILE_REASON_EOF) state->ended = true;
                    if (end->reason == MPV_END_FILE_REASON_ERROR) state->error = mpv_error_string(end->error);
                }
            }
        }
        const bool paused = !state->handle || state->flag("pause");
        const bool buffering = state->flag("paused-for-cache");
        status.Set("ready", state->ready); status.Set("ended", state->ended);
        status.Set("paused", paused); status.Set("buffering", buffering);
        status.Set("playing", state->ready && !paused && !buffering && !state->ended);
        status.Set("loading", !state->ready || buffering);
        status.Set("bufferedPosition", state->number("demuxer-cache-time"));
        status.Set("position", state->number("time-pos")); status.Set("duration", state->number("duration"));
        status.Set("error", state->error);
        return status;
    }));
    deck.Set("destroy", Napi::Function::New(env, [state](const Napi::CallbackInfo&) { state->close(); }));
    return deck;
}
