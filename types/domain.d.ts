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
    looksLikeM3u8?(content: string): boolean;
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

export type MediaRequestKind = 'hls' | 'direct';

export interface ClassifyMediaOptions {
  url?: string;
  contentType?: string;
  contentDisposition?: string;
  resourceType?: string;
}

export interface StreamSnifferModule {
  M3U8_CONTENT_TYPES: Set<string>;
  DIRECT_MEDIA_EXTENSIONS: Set<string>;
  DIRECT_MEDIA_EXACT_CONTENT_TYPES: Set<string>;
  NON_MEDIA_EXTENSIONS: Set<string>;
  isM3u8Url(url?: string): boolean;
  isM3u8ContentType(contentType?: string): boolean;
  looksLikeM3u8Request(opts?: ClassifyMediaOptions): boolean;
  getUrlExtension(url?: string): string;
  extensionFromFilename(name?: string): string;
  getContentDispositionExtension(contentDisposition?: string): string;
  isDirectMediaContentType(contentType?: string): boolean;
  isDirectMediaUrl(url?: string): boolean;
  looksLikeDirectMediaRequest(opts?: ClassifyMediaOptions): boolean;
  hasConflictingExtension(url?: string): boolean;
  classifyMediaRequest(opts?: ClassifyMediaOptions): MediaRequestKind | null;
}

export interface SnifferMediaItem {
  url: string;
  kind?: MediaRequestKind;
  headers?: Record<string, string>;
  size?: number;
  formattedSize?: string;
  timestamp?: number;
  pageTitle?: string;
  pageUrl?: string;
  cleanTitle?: string;
  manual?: boolean;
}

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  format: string;
  quality?: string;
  status: 'pending' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  speed?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  downloadedSegments?: number;
  totalSegments?: number;
  eta?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface DownloadHistoryItem {
  id: string;
  url: string;
  filename: string;
  format: string;
  size?: number;
  formattedSize?: string;
  completedAt: number;
  duration?: number;
}

export interface CatcherModule {
  init(): void;
  registerSidePanelPort(port: chrome.runtime.Port): void;
  clearTab(tabId: number): Promise<void>;
  getStreamsForTab(tabId: number): Promise<any>;
  registerManualStream(tabId: number, url: string): Promise<any>;
  handlePageTitleChanged(tabId: number, title: string, url?: string, cleanTitle?: string): void;
  recordMediaSize?(url: string, size: number): void;
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
  var StreamSniffer: StreamSnifferModule;
  var Catcher: CatcherModule;
  var UiFeedback: any;
  var PlayerController: any;
  var StateManager: any;
  var Hls: any;
  var lamejs: any;

  interface Window {
    muxjs?: any;
    lamejs?: any;
    StreamSniffer?: StreamSnifferModule;
    Catcher?: CatcherModule;
    webkitAudioContext?: typeof AudioContext;
  }
}
