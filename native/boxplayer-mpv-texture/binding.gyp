{
  "targets": [
    {
      "target_name": "mpv_texture",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "variables": { "enable_libmpv%": "false", "mac_libmpv_dir%": "deps/mpv/macos" },

      "conditions": [
        # ── macOS: build the real native addon (IOSurface GPU texture sharing) ──
        ["OS=='mac'", {
          "sources": [
            "src/native/addon.cpp",
            "src/native/mpv_context.cpp",
            "src/native/macos/iosurface_texture.mm"
          ],
          "include_dirs": [
            "deps/mpv/include"
          ],
          "libraries": [
            "-L<(module_root_dir)/<(mac_libmpv_dir)",
            "-lmpv",
            "-framework OpenGL",
            "-framework IOSurface",
            "-framework CoreFoundation"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_LDFLAGS": [
              "-Wl,-rpath,@loader_path"
            ]
          },
          "copies": [
            {
              "destination": "<(module_root_dir)/build/Release",
              "files": ["<(module_root_dir)/<(mac_libmpv_dir)/libmpv.dylib"]
            }
          ]
        }],

        # Default packaging remains a stub until a matching libmpv SDK and
        # runtime bundle are staged for the target architecture.
        ["OS!='mac' and enable_libmpv!='true'", {
          "sources": [
            "src/native/stub.cpp"
          ]
        }],
        ["OS=='win' and enable_libmpv=='true'", {
          "sources": [
            "src/native/addon.cpp",
            "src/native/mpv_context.cpp"
          ],
          "defines": ["BOXPLAYER_MPV_SOFTWARE"],
          "include_dirs": ["deps/mpv/include"],
          "libraries": [
            "<(module_root_dir)/deps/mpv/win32/<(target_arch)/mpv.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] }
          }
        }],
        ["OS=='linux' and enable_libmpv=='true'", {
          "sources": [
            "src/native/addon.cpp",
            "src/native/mpv_context.cpp"
          ],
          "defines": ["BOXPLAYER_MPV_SOFTWARE"],
          "include_dirs": ["deps/mpv/include"],
          "libraries": [
            "-L<(module_root_dir)/deps/mpv/linux/<(target_arch)",
            "-lmpv"
          ],
          "ldflags": ["-Wl,-rpath,\\$$ORIGIN"],
          "cflags_cc": ["-std=c++17"]
        }]
      ]
    }
  ]
}
