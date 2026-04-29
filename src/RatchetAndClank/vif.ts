import { assert, hexzero } from "../util";
import { DataViewExt } from "./DataViewExt";
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

enum VifUnpackVN {
    S = 0x00,
    V2 = 0x01,
    V3 = 0x02,
    V4 = 0x03,
}

enum VifUnpackVL {
    VL_32 = 0x00,
    VL_16 = 0x01,
    VL_8 = 0x02,
    VL_5 = 0x03,
}

export enum VifUnpackFormat {
    S_32 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_32),
    S_16 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_16),
    S_8 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_8),
    V2_32 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_32),
    V2_16 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_16),
    V2_8 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_8),
    V3_32 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_32),
    V3_16 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_16),
    V3_8 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_8),
    V4_32 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_32),
    V4_16 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_16),
    V4_8 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_8),
    V4_5 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_5),
}

function getVifUnpackVNComponentCount(vn: VifUnpackVN): number {
    return vn + 1;
}

function getVifUnpackFormatByteSize(format: number): number {
    const vn: VifUnpackVN = (format >>> 2) & 0x03;
    const vl: VifUnpackVL = (format >>> 0) & 0x03;
    const compCount = getVifUnpackVNComponentCount(vn);
    if (vl === VifUnpackVL.VL_8) {
        return 1 * compCount;
    } else if (vl === VifUnpackVL.VL_16) {
        return 2 * compCount;
    } else if (vl === VifUnpackVL.VL_32) {
        return 4 * compCount;
    } else if (vl === VifUnpackVL.VL_5) {
        // V4-5. Special case: 16 bits for the whole format.
        assert(vn === 0x03);
        return 2;
    } else {
        throw new Error("Invalid VIF unpack vnvl");
    }
}

export function readVifCommandList(view: DataViewExt) {
    const out: VifCommand[] = [];

    if (view.byteLength % 4 !== 0) {
        throw new Error(`VIF command list byte length must be a multiple of 4`);
    }

    // initial values
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
    const vifCmd = view.getUint32(0);

    const immediate = getBits(vifCmd, 0, 15);
    const num = getBits(vifCmd, 16, 23);
    const cmd = getBits(vifCmd, 24, 31);

    const isUnpack = isUnpackCommand(cmd);

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

        // command-specific fields
        unpack: isUnpack ? {
            vnvl: cmd & 0x0F,
            addr: getBits(immediate, 0, 9), // multiply by 16 to get an actual address
        } : null,

        get debug() {
            return {
                cmd: isUnpack ? "UNPACK" : VifCmd[cmd] ?? `UNKNOWN ${hexzero(cmd, 2)}`,
                vnvl: isUnpack ? VifUnpackFormat[cmd & 0x0F] : null,
            }
        },
    };
}

// returns the size of the command in bytes, including the command itself, without padding
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
            // sets MASK register to the next 32-bit word
            return 0x4 + 0x4;
        case VifCmd.STROW:
        case VifCmd.STCOL:
            // sets R0-R3 row registers to the next 4 32-bit words
            return 0x4 + (0x4 * 4);
        case VifCmd.MPG:
            // loads NUM*8 bytes into VU memory, if NUM is 0, then 2048 bytes are loaded
            return 0x4 + ((num * 8) || 2048);
        case VifCmd.DIRECT:
        case VifCmd.DIRECTHL:
            // Transfers IMMEDIATE 128-bit qwords to the GIF through PATH2, if IMMEDIATE is 0, 65,536 128-bit qwords are transferred
            return 0x4 + ((immediate || 65536) * 16);
        default: {
            assert(isUnpackCommand(cmd));

            num = num || 0x100;
            wl = wl || 0x100;

            const vnvl = cmd & 0x0F;
            const gsize = getVifUnpackFormatByteSize(vnvl);

            if (wl <= cl) {
                return 0x4 + num * gsize;
            } else {
                /**
                 * From EE user manual page 94
                 * ```
                 * CL x (num/WL)+limit(num%WL,CL)
                 * int limit(int a,int max) { return( a>max ? max: a); }
                 * ```
                 */
                // not tested, but this should work
                // function limit(a: number, max: number) { return a > max ? max : a; }
                // return 0x4 + (cl * Math.trunc(num / wl) + limit(num % wl, cl)) * gsize;
                throw new Error("Filling write unpacks not tested");
            }
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
    // sets the CYCLE register to IMMEDIATE. CYCLE.CL is bits 0-7, CYCLE.WL is bits 8-15
    const imm = vifCommand.immediate;
    return {
        cl: getBits(imm, 0, 7),
        wl: getBits(imm, 8, 15),
    };
}

export type VifUnpackReader = {
    next(): DataViewExt;
    hasNext(): boolean;
    peekNextVnvl(): number;
    peekNextAddr(): number;
};

export function vifUnpacks(commands: VifCommand[]) {
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

    return {
        // return the next unpack's data
        next(): DataViewExt {
            advanceToNext();
            const cmd = commands[i];
            i++; // advance past this command
            return readVifUnpackData(cmd);
        },
        hasNext() {
            advanceToNext(false);
            return !!commands[i];
        },
        peekNextVnvl() {
            advanceToNext();
            const cmd = commands[i];
            // do not advance i here
            return cmd.unpack!.vnvl;
        },
        peekNextAddr() {
            advanceToNext();
            const cmd = commands[i];
            // do not advance i here
            return cmd.unpack!.addr;
        },
    };
}

export function isUnpackCommand(cmd: number): boolean {
    return cmd >= 0x60 && cmd <= 0x7f;
}
