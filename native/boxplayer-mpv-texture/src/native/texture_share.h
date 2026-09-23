/*
 * Platform-agnostic texture sharing interface
 * Implementations: win32/dxgi_texture.cpp, macos/iosurface_texture.mm
 */

#ifndef TEXTURE_SHARE_H_
#define TEXTURE_SHARE_H_

#include <cstdint>
#include <memory>
#include <vector>

namespace mpv_texture {

// Texture format for shared textures
enum class TextureFormat {
    RGBA8,    // Standard RGBA
    NV12,     // YUV 4:2:0 (hardware decode output)
    BGRA8     // BGRA (macOS IOSurface native format)
};

// Information about an exported texture
struct TextureInfo {
    uint64_t handle;        // Platform-specific handle (HANDLE on Win, IOSurfaceRef pointer on Mac)
    uint32_t width;
    uint32_t height;
    TextureFormat format;
    bool is_valid;
    std::shared_ptr<std::vector<uint8_t>> pixels; // software renderer only
};

// Abstract interface for platform-specific texture sharing
class ITextureShare {
public:
    virtual ~ITextureShare() = default;

    // Initialize the texture sharing system
    // gl_context: Platform-specific GL context (HGLRC on Win, CGLContextObj on Mac)
    virtual bool initialize(void* gl_context) = 0;

    // Create a shared texture of the given size
    virtual bool createTexture(uint32_t width, uint32_t height) = 0;

    // Resize the shared texture
    virtual bool resizeTexture(uint32_t width, uint32_t height) = 0;

    // Get the OpenGL texture ID for mpv to render into
    virtual uint32_t getGLTexture() const = 0;

    // Get the OpenGL FBO ID
    virtual uint32_t getGLFBO() const = 0;

    // Lock the texture for rendering (call before mpv_render_context_render)
    virtual bool lockTexture() = 0;

    // Unlock and export the texture (call after mpv_render_context_render)
    // Returns the texture info for sharing with Electron
    virtual TextureInfo unlockAndExport() = 0;

    // Headless macOS runners can expose only the CGL software renderer. In
    // that case Electron cannot import an IOSurface through its GPU process,
    // so the rendered FBO is read back over the existing CPU frame path.
    // Hardware-backed Macs keep zero-copy texture sharing.
    virtual void setSoftwareReadback(bool enabled) { (void)enabled; }

    // Release a previously exported texture
    virtual void releaseTexture() = 0;

    // Clean up all resources
    virtual void destroy() = 0;
};

// Factory function - implemented per platform
ITextureShare* createTextureShare();

} // namespace mpv_texture

#endif // TEXTURE_SHARE_H_
