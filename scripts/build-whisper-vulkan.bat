@echo off
rem Builds whisper.cpp with Vulkan (GPU, works on AMD) into .models\whisper-vulkan.
rem Needs Visual Studio 2022 C++ tools and the Vulkan SDK. First run:
rem   git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp .models\whisper-src
set "MODELS=%~dp0..\.models"
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set "PATH=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%PATH%"
cmake -S "%MODELS%\whisper-src" -B "%MODELS%\whisper-vulkan" -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF || exit /b 1
cmake --build "%MODELS%\whisper-vulkan" --target whisper-cli whisper-server -j 12 || exit /b 1
