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
        assert(size <= view.byteLength);
        assert(size % 4 === 0);
        out.push(command);

        switch (command.cmd) {
            case VifCmd.STCYCL: {
                const stcycl = readVifStcyclData(command);
                wl = stcycl.wl;
                cl = stcycl.cl;
                break;
            }
        }

        view = view.subview(size);
    }

    return out;
}

type VifCommand = ReturnType<typeof readVifCommand>;
function readVifCommand(view: DataViewExt, wl: number, cl: number) {
    const vifCmd = view.getUint32(0);

    const immediate = getBits(vifCmd, 0, 15);
    const _num = getBits(vifCmd, 16, 23);
    const num = _num === 0 ? 256 : _num; // num 0 means 256 (EE manual page 88)
    const cmd = getBits(vifCmd, 24, 30);
    const irq = getBits(vifCmd, 31, 31);
    if (irq) debugger;

    const isUnpack = isUnpackCommand(cmd);

    const size = vifCommandSizeInBytes(cmd, num, immediate, wl, cl);
    if (size > view.byteLength) {
        throw new Error(`VIF command size exceeds remaining buffer size`);
    }

    return {
        view: view.subview(0, size),
        size,

        // main fields
        irq,
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
                cmd: (isUnpack ? "UNPACK" : VifCmd[cmd] ?? `UNKNOWN ${hexzero(cmd, 2)}`) + (irq ? " (IRQ)" : ""),
                vnvl: isUnpack ? VifUnpackFormat[cmd & 0x0F] : null,
            }
        },
    };
}

// returns the size of the command in bytes
// (EE manual page 87)
export function vifCommandSizeInBytes(cmd: number, num: number, immediate: number, wl: number, cl: number) {
    let packetLength = 0;
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
            packetLength = 1;
            break;
        case VifCmd.STMASK:
            packetLength = 1 + 1;
            break;
        case VifCmd.STROW:
        case VifCmd.STCOL:
            packetLength = 1 + 4;
            break;
        case VifCmd.MPG:
            packetLength = 1 + num * 2;
            break;
        case VifCmd.DIRECT:
        case VifCmd.DIRECTHL:
            const _immediate = immediate || 65536; // EE manual page 122
            packetLength = 1 + _immediate * 4;
            break;
        default: {
            assert(isUnpackCommand(cmd));

            const vn: VifUnpackVN = (cmd & 0b1100) >> 2
            const vl: VifUnpackVL = cmd & 0b0011;

            if (wl <= cl) {
                /**
                 * EE manual page 123:
                 * "//" means divide and round up
                 * 1+(((32>>vl) x (vn+1)) x num//32)
                 */
                packetLength = 1 + Math.ceil((((32 >> vl) * (vn + 1)) * num) / 32);
            } else {
                /**
                 * ```
                 * int limit(int a,int max) { return( a>max ? max: a); }
                 * n = CL x (num/WL)+limit(num%WL,CL)
                 * 1+(((32>>vl) x (vn+1)) x n//32)
                 * ```
                 */
                // not tested, but this should work
                // function limit(a: number, max: number) { return a > max ? max : a; }
                // const n = cl * Math.trunc(num / wl) + limit(num % wl, cl);
                // packetLength = 1 + Math.ceil((((32 >> vl) * (vn + 1)) * num) / 32);
                throw new Error("Filling write unpacks not tested");
            }
        }
    }
    return 0x4 * packetLength;
}

export function readVifUnpackData(vifCommand: VifCommand) {
    assert(isUnpackCommand(vifCommand.cmd));
    return vifCommand.view.subview(0x4);
}

export function readVifStrowData(vifCommand: VifCommand) {
    assert(vifCommand.cmd === VifCmd.STROW);
    return vifCommand.view.subview(0x4, 0x4 * 4).getTypedArrayView(Int32Array);
}

export function readVifStcyclData(vifCommand: VifCommand) {
    assert(vifCommand.cmd === VifCmd.STCYCL);
    return {
        cl: getBits(vifCommand.immediate, 0, 7),
        wl: getBits(vifCommand.immediate, 8, 15),
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

const UNPACK_MASK = 0b0110_0000;
export function isUnpackCommand(cmd: number): boolean {
    return (cmd & UNPACK_MASK) === UNPACK_MASK;
}
