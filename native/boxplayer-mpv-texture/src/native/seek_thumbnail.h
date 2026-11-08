#pragma once
#include <napi.h>
#include <mpv/client.h>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <utility>

// A separate headless decoder; never touches the process-wide playback context.
class SeekThumbnailWorker final : public Napi::AsyncWorker {
public:
    SeekThumbnailWorker(Napi::Env env, std::string url, std::string options,
                        std::string directory, std::shared_ptr<std::atomic_bool> cancelled)
        : Napi::AsyncWorker(env), result(Napi::Promise::Deferred::New(env)),
          url(std::move(url)), options(std::move(options)), directory(std::move(directory)), cancelled(cancelled) {}
    Napi::Promise promise() { return result.Promise(); }
    void Execute() override {
        if (*cancelled) return;
        mpv_handle* handle = mpv_create();
        if (!handle) return;
        const auto close = [&] { mpv_terminate_destroy(handle); };
        for (const auto& pair : {std::pair<const char*, const char*>{"config", "no"},
                {"vo", "image"}, {"vo-image-format", "png"}, {"aid", "no"}, {"sid", "no"},
                {"frames", "1"}, {"idle", "yes"}, {"keep-open", "no"}, {"pause", "no"},
                {"hwdec", "no"}, {"network-timeout", "3"}, {"cache", "no"},
                {"audio-display", "no"}, {"ytdl", "no"}, {"load-scripts", "no"},
                {"vf", "lavfi=[scale=w=320:h=180:force_original_aspect_ratio=decrease]"}, {"input-default-bindings", "no"}}) {
            if (mpv_set_option_string(handle, pair.first, pair.second) < 0) { close(); return; }
        }
        if (mpv_set_option_string(handle, "vo-image-outdir", directory.c_str()) < 0 || mpv_initialize(handle) < 0) { close(); return; }
        const char* command[] = {"loadfile", url.c_str(), "replace", "-1", options.c_str(), nullptr};
        if (mpv_command_async(handle, 0, command) < 0) { close(); return; }
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(6);
        while (!*cancelled && std::chrono::steady_clock::now() < deadline) {
            auto* event = mpv_wait_event(handle, .05);
            if (event->event_id == MPV_EVENT_END_FILE) {
                const auto* ended = static_cast<mpv_event_end_file*>(event->data);
                success = ended && ended->error >= 0;
                break;
            }
            if (event->event_id == MPV_EVENT_SHUTDOWN) break;
        }
        close();
    }
    void OnOK() override { result.Resolve(Napi::Boolean::New(Env(), success && !*cancelled)); }
    void OnError(const Napi::Error&) override { result.Resolve(Env().Null()); }
private:
    Napi::Promise::Deferred result;
    std::string url, options, directory;
    std::shared_ptr<std::atomic_bool> cancelled;
    bool success = false;
};

inline Napi::Value BeginSeekThumbnail(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    if (info.Length() != 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
        Napi::TypeError::New(env, "Expected URL, load options, output directory").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto cancelled = std::make_shared<std::atomic_bool>(false);
    auto* job = new SeekThumbnailWorker(env, info[0].As<Napi::String>().Utf8Value(),
        info[1].As<Napi::String>().Utf8Value(), info[2].As<Napi::String>().Utf8Value(), cancelled);
    auto result = Napi::Object::New(env);
    result.Set("promise", job->promise());
    result.Set("cancel", Napi::Function::New(env, [cancelled](const Napi::CallbackInfo&) { *cancelled = true; }));
    job->Queue();
    return result;
}
