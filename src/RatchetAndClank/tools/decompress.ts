import { DataViewExt } from "./DataViewExt.ts";

export function decompressWad(srcView: DataViewExt) {
    const beginPtr = 0x10;
    let srcPtr = beginPtr;

    let destBuf = new Uint8Array(2048);
    let destPtr = 0;

    if (srcView.byteLength < beginPtr) {
        throw new Error("WAD file is too small");
    }

    const compressedSize = srcView.getUint32(0x3);
    if (compressedSize !== srcView.byteLength) {
        throw new Error(`Buffer size doesn't match file header (expected ${compressedSize}, actual ${srcView.byteLength})`)
    }

    if (srcView.getFixedLengthString(0, 3) !== "WAD") {
        throw new Error("Not a WAD file")
    }

    const utils = {
        read8() {
            if (srcPtr >= srcView.byteLength) {
                throw new Error("Out of bounds read in decompression")
            }
            const srcValue = srcView.getUint8(srcPtr);
            srcPtr++;
            return srcValue;
        },
        peek8(offset: number) {
            if (srcPtr + offset >= srcView.byteLength) {
                throw new Error("Out of bounds read in decompression")
            }
            return srcView.getUint8(srcPtr + offset);
        },
        eof() {
            return srcPtr === srcView.byteLength;
        },
        resize() {
            if (destPtr === destBuf.length) {
                // reallocate
                const newBuf = new Uint8Array(destBuf.byteLength * 2);
                newBuf.set(destBuf);
                destBuf = newBuf;
            }
        },
        writeLit(bytes: number) {
            for (let i = 0; i < bytes; i++) {
                this.resize();
                destBuf[destPtr] = srcView.getUint8(srcPtr);
                srcPtr++;
                destPtr++;
            }
        },
        writeMatch(lookbackPtr: number, bytes: number) {
            if (lookbackPtr < 0 || lookbackPtr >= destPtr) {
                throw new Error("Out of bounds read in decompression")
            }
            for (let i = 0; i < bytes; i++) {
                this.resize();
                destBuf[destPtr] = destBuf[lookbackPtr];
                lookbackPtr++;
                destPtr++;
            }
        },
        bytesWritten() {
            return destPtr;
        },
        alignToNext4Kb() {
            while ((srcPtr - beginPtr) % 0x1000 !== 0) {
                srcPtr++;
            }
        }
    }

    while (srcPtr < srcView.byteLength) {
        decompressWadPacket(utils);
    }

    // ensure we output a real ArrayBuffer not a view
    const correctlySizedBuffer = new ArrayBuffer(destPtr);
    new Uint8Array(correctlySizedBuffer).set(destBuf.subarray(0, destPtr));
    return correctlySizedBuffer;
}

function decompressWadPacket(u: {
    read8: () => number;
    peek8: (offset: number) => number;
    eof: () => boolean;
    writeLit: (bytes: number) => void;
    writeMatch: (lookback: number, bytes: number) => void;
    bytesWritten: () => number;
    alignToNext4Kb: () => void;
}): number {
    const flag = u.read8();

    if (flag < 0x10) {
        // medium or big literal
        let literalSize = 0;
        if (flag !== 0) {
            literalSize = flag + 3;
        } else {
            literalSize = u.read8() + 18;
        }

        u.writeLit(literalSize);

        if (!u.eof()) {
            // next flag must not be a literal
            if (u.peek8(0) < 0x10) {
                throw new Error("Unexpected double literal")
            }
        }
    } else {
        let lookback = 0;
        let matchSize = 0;

        if (flag < 0x20) {
            // far match
            matchSize = flag & 7;
            if (matchSize === 0) {
                matchSize = u.read8() + 7;
            }

            const b0 = u.read8();
            const b1 = u.read8()
            lookback = u.bytesWritten() - ((flag & 8) * 0x800) - (b1 * 0x40) - (b0 >> 2);

            // not sure what this does
            if (lookback !== u.bytesWritten()) {
                matchSize += 2;
                lookback -= 0x4000;
            } else if (matchSize !== 1) {
                u.alignToNext4Kb();
                return flag;
            }
        } else if (flag < 0x40) {
            // medium match
            matchSize = flag & 0x1f;
            if (matchSize == 0) {
                matchSize = u.read8() + 0x1f;
            }
            matchSize += 2;

            const b1 = u.read8();
            const b2 = u.read8();
            lookback = u.bytesWritten() - (b2 * 0x40) - (b1 >> 2) - 1;
        } else {
            // little match
            const b1 = u.read8();
            lookback = u.bytesWritten() - (b1 * 8) - ((flag >> 2) & 7) - 1;
            matchSize = (flag >> 5) + 1;
        }

        if (matchSize !== 1) { // not sure why not if match size is 1
            // write match
            u.writeMatch(lookback, matchSize);
        }

        // little literal always follows match
        const littleLiteralSize = u.peek8(-2) & 3;
        u.writeLit(littleLiteralSize);
    }

    return flag;
}
