import { DataViewExt } from "./DataViewExt.ts";

export async function readTableOfContents(view: DataViewExt) {
    /*
      // size 0x2960
      // aka "RacWadInfo" or "global wad"
      struct TableOfContents {
        // 0x0000
        i32 version;
        // 0x0004
        i32 tocSize;
        // 0x0008
        SectorRange debug_font;
        // 0x0010
        SectorRange save_game;
        // 0x0018
        SectorRange ratchet_seqs[28];
        // 0x00f8
        SectorRange hud_seqs[20];
        // 0x0198
        SectorRange vendor;
        // 0x01a0
        SectorRange vendor_audio[37];
        // 0x02c8
        SectorRange help_controls[12];
        // 0x0328
        SectorRange help_moves[15];
        // 0x03a0
        SectorRange help_weapons[15];
        // 0x0418
        SectorRange help_gadgets[14];
        // 0x0488
        SectorRange help_ss[7];
        // 0x04c0
        SectorRange options_ss[7];
        // 0x04f8
        SectorRange frontbin;
        // 0x0500
        SectorRange mission_ss[81];
        // 0x0788
        SectorRange planets[19];
        // 0x0820
        SectorRange stuff2[38];
        // 0x0950
        SectorRange goodies_images[10];
        // 0x09a0
        SectorRange character_sketches[19];
        // 0x0a38
        SectorRange character_renders[19];
        // 0x0ad0
        SectorRange skill_images[31];
        // 0x0bc8
        SectorRange epilogue_english[12];
        // 0x0c28
        SectorRange epilogue_french[12];
        // 0x0c88
        SectorRange epilogue_italian[12];
        // 0x0ce8
        SectorRange epilogue_german[12];
        // 0x0d48
        SectorRange epilogue_spanish[12];
        // 0x0da8
        SectorRange sketchbook[30];
        // 0x0e98
        SectorRange commercials[4];
        // 0x0eb8
        SectorRange item_images[9];
        // 0x0f00
        Sector32 qwark_boss_audio[240];
        // 0x12c0
        SectorRange irx;
        // 0x12c8
        SectorRange spaceships[4];
        // 0x12e8
        SectorRange anim_looking_thing_2[20];
        // 0x1388
        SectorRange space_plates[6];
        // 0x13b8
        SectorRange transition;
        // 0x13c0
        SectorRange space_audio[36];
        // 0x14e0
        SectorRange sound_bank;
        // 0x14e0
        SectorRange wad_14e0;
        // 0x14e0
        SectorRange music;
        // 0x14f8
        SectorRange hud_header;
        // 0x1500
        SectorRange hud_banks[5];
        // 0x1528
        SectorRange all_text;
        // 0x1530
        SectorRange things[28];
        // 0x1610
        SectorRange post_credits_helpdesk_girl_seq;
        // 0x1618
        SectorRange post_credits_audio[18];
        // 0x16a8
        SectorRange credits_images_ntsc[20];
        // 0x1748
        SectorRange credits_images_pal[20];
        // 0x17e8
        SectorRange wad_things[2];
        // 0x17f8
        SectorByteRange mpegs[88];
        // 0x1ab8
        Sector32 help_audio[900];
        // 0x28c8
        SectorRange levels[19];
      }
    */
    const version = view.getInt32(0x4);
    const size = view.getInt32(0x4);

    return {
        version,
        size,
        levelSectors: view.subdivide(0x28c8, 19, 0x8).map(view => {
            return view.getInt32PairAs(0, "startSector", "sizeInSectors");
        }),
    }
}

export const SIZEOF_LEVEL_HEADER = 0x2434;
export type LevelDescriptor = Awaited<ReturnType<typeof readLevelDescriptor>>
export async function readLevelDescriptor(view: DataViewExt) {
    /*
      // size 0x2434
      // aka "Rac1AmalgamatedWadHeader"
      struct LevelDescriptor {
        // 0x000
        i32 id;
        // 0x004
        i32 header_size;
        // 0x008
        SectorRange data;
        // 0x010
        SectorRange gameplay_ntsc;
        // 0x018
        SectorRange gameplay_pal;
        // 0x020
        SectorRange occlusion;
        // 0x028
        SectorRangeBytes bindata[36];
        // 0x148
        Sector music[15];
        // 0x184
        SceneHeader scenes[30];
      }
      // size 0x128
      struct SceneHeader {
        // 0x00
        Sector sounds[6];
        // 0x18
        Sector wads[68];
      }
    */

    if (view.getInt32(0x4) !== SIZEOF_LEVEL_HEADER) {
        return null;
    }

    const tocItem = {
        id: view.getInt32(0),
        headerSize: view.getInt32(0x4),
        data: view.getInt32PairAs(0x8, "startSector", "sizeInSectors"),
        gameplayNtsc: view.getInt32PairAs(0x10, "startSector", "sizeInSectors"),
        gameplayPal: view.getInt32PairAs(0x18, "startSector", "sizeInSectors"),
        occlusion: view.getInt32PairAs(0x20, "startSector", "sizeInSectors"),
        bindata: view.subdivide(0x28, 36, 0x8).map(view => {
            return view.getInt32PairAs(0, "startSector", "sizeInBytes");
        }),
        music: view.subdivide(0x148, 15, 0x4).map(view => {
            return view.getInt32(0);
        }),
        scenes: view.subdivide(0x184, 30, 0x128).map(view => {
            return {
                sounds: view.getArrayOfNumbers(0, 6, Int32Array),
                wads: view.getArrayOfNumbers(0x18, 68, Int32Array),
            };
        }),
    }

    return tocItem;
}

export type LevelDataHeader = Awaited<ReturnType<typeof readLevelDataHeader>>;
export async function readLevelDataHeader(view: DataViewExt) {
    /*
      // size 0x58
      packed_struct(RacLevelDataHeader,
        // 0x00
        ByteRange overlay;
        // 0x08
        ByteRange sound_bank;
        // 0x10
        ByteRange core_index;
        // 0x18
        ByteRange gs_ram;
        // 0x20
        ByteRange hud_header;
        // 0x28
        ByteRange hud_banks[5];
        // 0x50
        ByteRange core_data;
      )
    */

    return {
        overlay: view.getInt32PairAs(0x0, "offset", "size"),
        soundBank: view.getInt32PairAs(0x8, "offset", "size"),
        coreIndex: view.getInt32PairAs(0x10, "offset", "size"),
        gsRam: view.getInt32PairAs(0x18, "offset", "size"),
        hudHeader: view.getInt32PairAs(0x20, "offset", "size"),
        hudBanks: view.subdivide(0x28, 5, 0x8).map(view => view.getInt32PairAs(0, "offset", "size")),
        coreData: view.getInt32PairAs(0x50, "offset", "size")
    }
}
