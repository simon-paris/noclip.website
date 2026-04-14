import { DataViewExt } from "../DataViewExt";
import { getBits } from "./utils";

export enum VifCmd {
    NOP = 0b0000000,
    STCYCL = 0b0000001,
    OFFSET = 0b0000010,
    BASE = 0b0000011,
    ITOP = 0b0000100,
    STMOD = 0b0000101,
    MSKPATH3 = 0b0000110,
    MARK = 0b0000111,
    FLUSHE = 0b0010000,
    FLUSH = 0b0010001,
    FLUSHA = 0b0010011,
    MSCAL = 0b0010100,
    MSCNT = 0b0010111,
    MSCALF = 0b0010101,
    STMASK = 0b0100000,
    STROW = 0b0110000,
    STCOL = 0b0110001,
    MPG = 0b1001010,
    DIRECT = 0b1010000,
    DIRECTHL = 0b1010001
};

export enum VifVnVl {
    S_32 = 0b0000,
    S_16 = 0b0001,
    ERR_0010 = 0b0010,
    ERR_0011 = 0b0011,
    V2_32 = 0b0100,
    V2_16 = 0b0101,
    V2_8 = 0b0110,
    ERR_0111 = 0b0111,
    V3_32 = 0b1000,
    V3_16 = 0b1001,
    V3_8 = 0b1010,
    ERR_1011 = 0b1011,
    V4_32 = 0b1100,
    V4_16 = 0b1101,
    V4_8 = 0b1110,
    V4_5 = 0b1111
};

export function readVifCommandList(view: DataViewExt) {
    const out: VifCommand[] = [];

    if (view.byteLength % 4 !== 0) {
        throw new Error(`VIF command list byte length must be a multiple of 4`);
    }

    // not sure what the initial values should be
    let wl = 1, cl = 1;

    while (view.byteLength) {
        const command = readVifCommand(view, wl, cl);
        const size = vifCommandSizeInBytes(command.cmd, command.num, command.immediate, wl, cl);
        if (size > view.byteLength) {
            throw new Error(`VIF command size exceeds remaining buffer size`);
        }
        out.push(command);

        switch (command.cmd) {
            case VifCmd.STCYCL: {
                const stcycl = readVifStcyclData(command);
                wl = stcycl.wl;
                cl = stcycl.cl;
                break;
            }
        }

        const align = size % 4 !== 0 ? 4 - (size % 4) : 0
        view = view.subview(size + align);
    }

    return out;
}

type VifCommand = ReturnType<typeof readVifCommand>;
function readVifCommand(view: DataViewExt, wl: number, cl: number) {
    /*
    struct VifCommand {
        u16 immediate;
        u8 num;
        u8 cmd;
        // data follows depending on command
    }
    */

    const immediate = view.getUint16(0x0);
    const num = view.getUint8(0x2);
    const cmd = view.getUint8(0x3);

    const isUnpack = isUnpackCommand(cmd);
    const cmdString = VifCmd[cmd] ?? (isUnpack ? "UNPACK" : null);
    if (!cmdString) {
        throw new Error(`Unknown VIF command: 0b${cmd.toString(16).padStart(2, "0")}`);
    }

    const size = vifCommandSizeInBytes(cmd, num, immediate, wl, cl);
    if (size > view.byteLength) {
        throw new Error(`VIF command size exceeds remaining buffer size`);
    }

    return {
        view: view.subview(0, size),
        size,

        // main fields
        cmd,
        num,
        immediate,

        // computed fields
        cmdString,

        // command-specific fields
        unpack: isUnpack ? {
            vnvl: cmd & 0x0F,
            vnvlStr: VifVnVl[cmd & 0x0F] ?? `Unknown`,
            /** multiply by 16 to get an actual address */
            addr: getBits(immediate, 0, 9),
        } : null,
    };
}

export function vifCommandSizeInBytes(cmd: number, num: number, immediate: number, wl: number, cl: number) {
    switch (cmd) {
        case VifCmd.NOP:
        case VifCmd.STCYCL:
        case VifCmd.OFFSET:
        case VifCmd.BASE:
        case VifCmd.ITOP:
        case VifCmd.STMOD:
        case VifCmd.MSKPATH3:
        case VifCmd.MARK:
        case VifCmd.FLUSHE:
        case VifCmd.FLUSH:
        case VifCmd.FLUSHA:
        case VifCmd.MSCAL:
        case VifCmd.MSCNT:
        case VifCmd.MSCALF:
            return 0x4;
        case VifCmd.STMASK:
            // 20h STMASK
            // Sets the MASK register to the next 32-bit word in the stream. This is used for UNPACK write masking.
            return 0x4 + 0x4;
        case VifCmd.STROW:
        case VifCmd.STCOL:
            // 30h STROW
            // Sets the R0-R3 row registers to the next 4 32-bit words in the stream. This is used for UNPACK write filling.
            // 31h STCOL
            // Sets the C0-C3 column registers to the next 4 32-bit words in the stream. This is used for UNPACK write filling.
            return 0x4 + (0x4 * 4);
        case VifCmd.MPG:
            // 4Ah MPG
            // Loads NUM*8 bytes into VU micro memory, starting at the given address IMMEDIATE*8. If the VU is currently active, MPG stalls until the VU is finished before uploading data.
            // If NUM is 0, then 2048 bytes are loaded.
            return 0x4 + ((num * 8) || 2048);
        case VifCmd.DIRECT:
        case VifCmd.DIRECTHL:
            // 50h DIRECT (VIF1)
            // Transfers IMMEDIATE quadwords to the GIF through PATH2. If PATH2 cannot take control of the GIF, the VIF stalls until PATH2 is activated.
            // If IMMEDIATE is 0, 65,536 quadwords are transferred.
            return 0x4 + ((immediate || 65536) * 16);
        default: {
            // 60h-7Fh UNPACK
            // Decompresses data in various formats to the given address in bits 0-9 of IMMEDIATE multiplied by 16.
            // If bit 14 of IMMEDIATE is set, the decompressed data is zero-extended. Otherwise, it is sign-extended.
            // If bit 15 of IMMEDIATE is set, TOPS is added to the starting address. This is only applicable for VIF1.
            // Bits 0-3 of CMD determine the type of UNPACK that occurs. See VIF UNPACK for details.
            // Bit 4 of CMD performs UNPACK write masking if set.

            // https://github.com/PCSX2/pcsx2/blob/e14b4475ffbea0ecf184deb76ec6d4c8b3ee273b/pcsx2/Vif_Unpack.cpp#L219

            num = num || 0x100;
            wl = wl || 0x100;

            // these bits of the cmd determine the data type and vector size
            const vl = cmd & 0x03;
            const vn = (cmd >> 2) & 0x3;

            const bytesPerElement = (32 >> vl) / 8;
            const elementsPerVector = vn + 1;

            const gsize = elementsPerVector * bytesPerElement;

            let size = 0;
            if (wl <= cl) {
                // Skipping write
                // wl is the number of qwords written to the output per write cycle, and cl is the stride between write cycles in qwords.
                // if cl>wl, then all of the vector elements are written and no data is skipped, so we can just multiply to get the input size
                size = num * gsize;
            } else {
                // Filling write
                // if wl>cl, then only wl elements of the input vector are present, so the input will be smaller
                size = (cl * Math.trunc(num / wl) + (num % wl > cl ? cl : num % wl)) * gsize;
            }
            return 0x4 + size;
        }
    }
}

export function readVifUnpackData(vifCommand: VifCommand) {
    if (!isUnpackCommand(vifCommand.cmd)) {
        throw new Error(`Not an UNPACK command`);
    }
    return vifCommand.view.subview(0x4);
}

export function readVifStrowData(vifCommand: VifCommand) {
    if (vifCommand.cmd !== VifCmd.STROW) {
        throw new Error(`Not a STROW command`);
    }
    // STROW packets are followed by 128 bits of data
    return vifCommand.view.subview(0x4, 0x4 * 4).getTypedArrayView(Int32Array);
}

export function readVifStcyclData(vifCommand: VifCommand) {
    if (vifCommand.cmd !== VifCmd.STCYCL) {
        throw new Error(`Not a STCYCL command`);
    }
    // Sets the CYCLE register to IMMEDIATE. In particular, CYCLE.CL is set to bits 0-7 and CYCLE.WL is set to bits 8-15.
    const imm = vifCommand.immediate;
    return {
        cl: getBits(imm, 0, 7),
        wl: getBits(imm, 8, 15),
    };
}

export function vifUnpacks(commands: VifCommand[]): (() => DataViewExt) & { nextVnvl: () => VifVnVl, nextAddr: () => number, hasNext: () => boolean } {
    let i = 0;

    function advanceToNext(failIfNotFound: boolean = true) {
        for (; i < commands.length; i++) {
            const cmd = commands[i];
            if (isUnpackCommand(cmd.cmd)) {
                return;
            }
        }
        if (failIfNotFound) {
            throw new Error(`No more UNPACK commands in list`);
        }
    }

    const fn = function (): DataViewExt {
        advanceToNext();
        const cmd = commands[i];
        i++; // advance past this command
        return readVifUnpackData(cmd);
    };

    (fn as any).nextVnvl = function (): VifVnVl {
        advanceToNext();
        const cmd = commands[i];
        // do not advance i here
        return cmd.unpack!.vnvl;
    };

    (fn as any).nextAddr = function (): number {
        advanceToNext();
        const cmd = commands[i];
        // do not advance i here
        return cmd.unpack!.addr;
    };

    (fn as any).hasNext = function (): boolean {
        advanceToNext(false);
        return !!commands[i];
    };

    return fn as (() => DataViewExt) & { nextVnvl: () => VifVnVl, nextAddr: () => number, hasNext: () => boolean };
}

export function isUnpackCommand(cmd: number): boolean {
    return cmd >= 0x60 && cmd <= 0x7f;
}
