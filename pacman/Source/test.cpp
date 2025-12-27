// Simple test program for WebAssembly compilation
#include <iostream>
#include <emscripten.h>

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    int main() {
        std::cout << "Hello from WebAssembly!" << std::endl;
        return 0;
    }
    
    EMSCRIPTEN_KEEPALIVE
    int add(int a, int b) {
        return a + b;
    }
    
    EMSCRIPTEN_KEEPALIVE
    const char* getMessage() {
        return "Pacman WebAssembly is working!";
    }
}
