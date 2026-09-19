/**
 * Domain types and ambient declarations for StegoClip.
 */

export interface Segment {
  index: number;
  url: string;
  duration: number;
  startTime: number;
  endTime: number;
  readonly start?: number;
  readonly end?: number;
}

export interface ClipPlan {
  segments: Segment[];
  firstSegmentStart: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
}

export interface Timeline {
  segments: Segment[];
  totalDuration: number;
  getOverlappingSegments(startSec: number, endSec: number): Segment[];
  getClipPlan(startSec: number, endSec: number): ClipPlan;
}

export interface Variant {
  url: string;
  bandwidth: number;
  resolution: string | null;
  height: number;
  frameRate?: number | null;
  codecs?: string | null;
  label: string;
}

export interface StegoParserModule {
  Timeline: new (segments?: Segment[]) => Timeline;
  PlaylistParser: {
    parseVariants(masterContent: string, masterUrl: string): Variant[];
    resolveSubPlaylist(masterContent: string, masterUrl: string): string;
    parseManifest(manifestContent: string, baseUrl: string): Timeline;
    parseMediaPlaylist(manifestContent: string, baseUrl: string): Timeline;
  };
}

export interface UnfragmentOptions {
  trimStart?: number;
  trimEnd?: number;
  audioOnly?: boolean;
}

export interface StegoTransmuxerModule {
  transmuxTsToMp4(bytes: Uint8Array, duration?: number, options?: UnfragmentOptions): Uint8Array;
  transmuxTsToAudioMp4?(
    bytes: Uint8Array,
    duration?: number,
    options?: UnfragmentOptions
  ): Uint8Array;
  unfragmentFmp4(bytes: Uint8Array, duration?: number, options?: UnfragmentOptions): Uint8Array;
  buildElst?(movieDurationTicks: number, mediaTimeTrackTicks: number): Uint8Array;
  buildEdts?(elstBox: Uint8Array): Uint8Array;
  fixFileDuration(data: Uint8Array, duration: number): Uint8Array;
}

declare global {
  function importScripts(...urls: string[]): void;

  interface Node {
    tagName?: string;
    querySelectorAll?: any;
  }

  interface ShadowRoot {
    URL?: any;
    activeViewTransition?: any;
    alinkColor?: any;
  }

  interface HTMLElement {
    value?: any;
    checked?: any;
    disabled?: any;
    options?: any;
  }

  interface Error {
    status?: any;
  }

  var StegoParser: StegoParserModule;
  var StegoTransmuxer: StegoTransmuxerModule;
  var StegoDecoder: any;
  var StegoDownloader: any;
  var StegoTime: any;
  var StegoMp3Encoder: any;
  var StegoBytes: any;
  var StegoConstants: any;
  var UiFeedback: any;
  var PlayerController: any;
  var StateManager: any;
  var Hls: any;
  var lamejs: any;

  interface Window {
    muxjs?: any;
    lamejs?: any;
    webkitAudioContext?: typeof AudioContext;
  }
}
