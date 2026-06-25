/// <reference lib="dom" />

interface Window {
  webkitAudioContext?: typeof AudioContext;
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}

interface SpeechRecognition extends EventTarget {
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  start(): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}

type BluetoothServiceUUID = string;
type BluetoothCharacteristicUUID = string;

interface BluetoothDevice extends EventTarget {
  gatt?: BluetoothRemoteGATTServer;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothGATTService>;
}

interface BluetoothGATTService {
  getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothGATTCharacteristic>;
}

interface BluetoothGATTCharacteristic {
  readValue(): Promise<DataView>;
}

interface Navigator {
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices?: boolean;
      optionalServices?: BluetoothServiceUUID[];
    }): Promise<BluetoothDevice>;
  };
}

declare const L: {
  map(el: string): LeafletMap;
  tileLayer(url: string, opts: Record<string, unknown>): { addTo(map: LeafletMap): void };
  circleMarker(latlng: [number, number], opts: Record<string, unknown>): LeafletLayer;
  circle(latlng: [number, number], opts: Record<string, unknown>): LeafletLayer;
  polyline(latlngs: [number, number][], opts: Record<string, unknown>): LeafletLayer;
};

interface LeafletMap {
  setView(latlng: [number, number], zoom: number): void;
  getZoom(): number;
  removeLayer(layer: LeafletLayer): void;
  on(event: string, fn: () => void): void;
  invalidateSize(): void;
  _hasGps?: boolean;
  _userPanned?: boolean;
}

interface LeafletLayer {
  bindPopup(html: string): LeafletLayer;
  addTo(map: LeafletMap): LeafletLayer;
}

declare const THREE: {
  Scene: new () => ThreeScene;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreeCamera;
  WebGLRenderer: new (opts: Record<string, unknown>) => ThreeRenderer;
  DirectionalLight: new (color: number, intensity: number) => ThreeLight;
  AmbientLight: new (color: number, intensity: number) => ThreeLight;
  SphereGeometry: new (radius: number, w: number, h: number) => ThreeGeometry;
  MeshBasicMaterial: new (opts: Record<string, unknown>) => ThreeMaterial;
  Mesh: new (geo: ThreeGeometry, mat: ThreeMaterial) => ThreeMesh;
  Line: new (geo: ThreeGeometry, mat: ThreeMaterial) => ThreeLine;
  BufferGeometry: new () => { setFromPoints(pts: ThreeVector3[]): void };
  LineBasicMaterial: new (opts: Record<string, unknown>) => ThreeMaterial;
};

interface ThreeScene {
  add(obj: unknown): void;
}

interface ThreeCamera {
  position: { set(x: number, y: number, z: number): void };
  lookAt(x: number, y: number, z: number): void;
}

interface ThreeRenderer {
  setSize(w: number, h: number): void;
  setClearColor(color: number): void;
  domElement: HTMLElement;
  render(scene: ThreeScene, camera: ThreeCamera): void;
}

interface ThreeLight {
  position: { set(x: number, y: number, z: number): void };
}

interface ThreeGeometry {}
interface ThreeMaterial {}
interface ThreeMesh {
  position: { set(x: number, y: number, z: number): void };
  rotation: { y: number };
}
interface ThreeLine {}
interface ThreeVector3 {
  clone(): ThreeVector3;
}
