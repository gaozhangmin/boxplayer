/*
 * macOS IOSurface texture sharing implementation
 * Triple-buffered: mpv writes to one surface while Electron reads another
 */

#ifdef __APPLE__

#include "../texture_share.h"
#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl3.h>
#include <OpenGL/OpenGL.h>
#include <OpenGL/CGLIOSurface.h>
#include <IOSurface/IOSurface.h>
#include <CoreFoundation/CoreFoundation.h>
#include <array>
#include <iostream>
#include <vector>

namespace mpv_texture {

static const int BUFFER_COUNT = 3;

struct IOSurfaceSlot {
    IOSurfaceRef ioSurface = nullptr;
    GLuint glTexture = 0;
    GLuint glFBO = 0;
};

class IOSurfaceTextureShare : public ITextureShare {
public:
    IOSurfaceTextureShare() = default;
    ~IOSurfaceTextureShare() override { destroy(); }

    bool initialize(void* gl_context) override {
        m_cglContext = static_cast<CGLContextObj>(gl_context);
        if (!m_cglContext) {
            m_cglContext = CGLGetCurrentContext();
        }

        if (!m_cglContext) {
            std::cerr << "[IOSurface] No CGL context available" << std::endl;
            return false;
        }

        m_initialized = true;
        return true;
    }

    bool createTexture(uint32_t width, uint32_t height) override {
        if (!m_initialized) return false;

        m_width = width;
        m_height = height;

        for (int i = 0; i < BUFFER_COUNT; i++) {
            if (!createSlot(m_slots[i], width, height)) {
                for (int j = 0; j < i; j++) {
                    destroySlot(m_slots[j]);
                }
                return false;
            }
        }

        m_writeIndex = 0;
        std::cout << "[IOSurface] Created " << BUFFER_COUNT << " triple-buffered textures "
                  << width << "x" << height << std::endl;
        return true;
    }

    bool resizeTexture(uint32_t width, uint32_t height) override {
        if (width == m_width && height == m_height) {
            return true;
        }

        // Electron may still import a previously exported IOSurface when mpv
        // reports the video's actual dimensions. Keep those surfaces alive
        // until this playback context is destroyed.
        std::array<IOSurfaceRef, BUFFER_COUNT> retired{};
        for (int i = 0; i < BUFFER_COUNT; i++) {
            retired[i] = m_slots[i].ioSurface;
            m_slots[i].ioSurface = nullptr;
            destroySlot(m_slots[i]);
        }
        m_retiredSurfaces.push_back(retired);

        return createTexture(width, height);
    }

    uint32_t getGLTexture() const override {
        return m_slots[m_writeIndex].glTexture;
    }

    uint32_t getGLFBO() const override {
        return m_slots[m_writeIndex].glFBO;
    }

    bool lockTexture() override {
        if (!m_slots[m_writeIndex].ioSurface) return false;
        // No IOSurfaceLock needed — GPU-to-GPU sharing uses glFlush for sync
        m_locked = true;
        return true;
    }

    TextureInfo unlockAndExport() override {
        TextureInfo info = {};

        if (!m_locked) {
            return info;
        }

        m_locked = false;

        auto& slot = m_slots[m_writeIndex];

        if (m_softwareReadback) {
            auto pixels = std::make_shared<std::vector<uint8_t>>(static_cast<size_t>(m_width) * m_height * 4);
            while (glGetError() != GL_NO_ERROR) {}
            glBindFramebuffer(GL_FRAMEBUFFER, slot.glFBO);
            glReadBuffer(GL_COLOR_ATTACHMENT0);
            glReadPixels(0, 0, static_cast<GLsizei>(m_width), static_cast<GLsizei>(m_height), GL_RGBA, GL_UNSIGNED_BYTE, pixels->data());
            const bool valid = glGetError() == GL_NO_ERROR;
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
            info.handle = 0;
            info.width = m_width;
            info.height = m_height;
            info.format = TextureFormat::RGBA8;
            info.is_valid = valid;
            info.pixels = pixels;
            m_writeIndex = (m_writeIndex + 1) % BUFFER_COUNT;
            return info;
        }

        // Pass IOSurfaceRef as raw pointer — Electron's importSharedTexture expects
        // the ioSurface Buffer to contain the IOSurfaceRef pointer, not the IOSurfaceID.
        info.handle = reinterpret_cast<uint64_t>(slot.ioSurface);
        info.width = m_width;
        info.height = m_height;
        info.format = TextureFormat::BGRA8;
        info.is_valid = true;

        // Swap to next buffer for next frame
        m_writeIndex = (m_writeIndex + 1) % BUFFER_COUNT;

        return info;
    }

    void setSoftwareReadback(bool enabled) override {
        m_softwareReadback = enabled;
        if (enabled) std::cout << "[IOSurface] Electron GPU import unavailable; using CPU frame readback" << std::endl;
    }

    void releaseTexture() override {
        // No-op with triple buffering - mpv always has a free slot to write to
    }

    void destroy() override {
        m_locked = false;

        for (int i = 0; i < BUFFER_COUNT; i++) {
            destroySlot(m_slots[i]);
        }
        for (const auto& generation : m_retiredSurfaces) {
            for (IOSurfaceRef surface : generation) {
                if (surface) CFRelease(surface);
            }
        }
        m_retiredSurfaces.clear();

        m_initialized = false;
    }

private:
    bool createSlot(IOSurfaceSlot& slot, uint32_t width, uint32_t height) {
        // Create IOSurface
        CFMutableDictionaryRef properties = CFDictionaryCreateMutable(
            kCFAllocatorDefault,
            0,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks
        );

        int32_t w = static_cast<int32_t>(width);
        int32_t h = static_cast<int32_t>(height);
        int32_t bytesPerElement = 4;
        int32_t bytesPerRow = width * bytesPerElement;
        int32_t pixelFormat = 'BGRA'; // kCVPixelFormatType_32BGRA

        CFNumberRef widthNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &w);
        CFNumberRef heightNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &h);
        CFNumberRef bpeNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &bytesPerElement);
        CFNumberRef bprNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &bytesPerRow);
        CFNumberRef pfNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &pixelFormat);

        CFDictionarySetValue(properties, kIOSurfaceWidth, widthNum);
        CFDictionarySetValue(properties, kIOSurfaceHeight, heightNum);
        CFDictionarySetValue(properties, kIOSurfaceBytesPerElement, bpeNum);
        CFDictionarySetValue(properties, kIOSurfaceBytesPerRow, bprNum);
        CFDictionarySetValue(properties, kIOSurfacePixelFormat, pfNum);

        slot.ioSurface = IOSurfaceCreate(properties);

        CFRelease(widthNum);
        CFRelease(heightNum);
        CFRelease(bpeNum);
        CFRelease(bprNum);
        CFRelease(pfNum);
        CFRelease(properties);

        if (!slot.ioSurface) {
            std::cerr << "[IOSurface] Failed to create IOSurface" << std::endl;
            return false;
        }

        // Create OpenGL texture backed by IOSurface
        glGenTextures(1, &slot.glTexture);
        glBindTexture(GL_TEXTURE_RECTANGLE, slot.glTexture);

        CGLError err = CGLTexImageIOSurface2D(
            m_cglContext,
            GL_TEXTURE_RECTANGLE,
            GL_RGBA8,
            width,
            height,
            GL_BGRA,
            GL_UNSIGNED_INT_8_8_8_8_REV,
            slot.ioSurface,
            0
        );

        if (err != kCGLNoError) {
            std::cerr << "[IOSurface] Failed to bind IOSurface to texture: " << err << std::endl;
            return false;
        }

        // Create FBO
        glGenFramebuffers(1, &slot.glFBO);
        glBindFramebuffer(GL_FRAMEBUFFER, slot.glFBO);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_RECTANGLE, slot.glTexture, 0);

        GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
        if (status != GL_FRAMEBUFFER_COMPLETE) {
            std::cerr << "[IOSurface] FBO incomplete: " << std::hex << status << std::endl;
            return false;
        }

        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        return true;
    }

    void destroySlot(IOSurfaceSlot& slot) {
        if (slot.glFBO) {
            glDeleteFramebuffers(1, &slot.glFBO);
            slot.glFBO = 0;
        }
        if (slot.glTexture) {
            glDeleteTextures(1, &slot.glTexture);
            slot.glTexture = 0;
        }
        if (slot.ioSurface) {
            CFRelease(slot.ioSurface);
            slot.ioSurface = nullptr;
        }
    }

    bool m_initialized = false;
    bool m_locked = false;
    bool m_softwareReadback = false;
    uint32_t m_width = 0;
    uint32_t m_height = 0;

    CGLContextObj m_cglContext = nullptr;

    // Triple-buffered texture slots
    IOSurfaceSlot m_slots[BUFFER_COUNT];
    std::vector<std::array<IOSurfaceRef, BUFFER_COUNT>> m_retiredSurfaces;
    int m_writeIndex = 0;
};

// Factory function
ITextureShare* createTextureShare() {
    return new IOSurfaceTextureShare();
}

} // namespace mpv_texture

#endif // __APPLE__
