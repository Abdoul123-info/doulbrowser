import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import obfuscator from 'rollup-plugin-javascript-obfuscator'

export default defineConfig({
    main: {
        plugins: [
            externalizeDepsPlugin(),
            ...(process.env.NODE_ENV === 'production' ? [
                obfuscator({
                    compact: true,
                    controlFlowFlattening: true,
                    controlFlowFlatteningThreshold: 1,
                    numbersToExpressions: true,
                    simplify: true,
                    stringArray: true,
                    stringArrayEncoding: ['base64'],
                    stringArrayThreshold: 1,
                    splitStrings: true,
                    splitStringsChunkLength: 5,
                    unicodeEscapeSequence: true,
                    identifierNamesGenerator: 'hexadecimal',
                    renameGlobals: false
                })
            ] : [])
        ],
        build: {
            rollupOptions: {
                external: ['electron']
            }
        }
    },
    preload: {
        plugins: [
            externalizeDepsPlugin(),
            ...(process.env.NODE_ENV === 'production' ? [
                obfuscator({
                    compact: true,
                    controlFlowFlattening: true,
                    controlFlowFlatteningThreshold: 1,
                    numbersToExpressions: true,
                    simplify: true,
                    stringArray: true,
                    stringArrayEncoding: ['base64'],
                    stringArrayThreshold: 1,
                    splitStrings: true,
                    splitStringsChunkLength: 5,
                    unicodeEscapeSequence: true,
                    identifierNamesGenerator: 'hexadecimal',
                    renameGlobals: false // Keep true only if you are sure it won't break Electron IPC
                })
            ] : [])
        ],
        build: {
            rollupOptions: {
                external: ['electron']
            }
        }
    },
    renderer: {
        server: {
            host: '0.0.0.0', // Listen on all interfaces
            port: 9527,
            strictPort: true // Fail if port is busy instead of shifting
        },
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer/src')
            }
        },
        plugins: [react()]
    }
})

