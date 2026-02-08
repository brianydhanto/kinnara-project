import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, HostListener, signal, ViewChild, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { Camera } from '@mediapipe/camera_utils';
import { FaceMesh } from '@mediapipe/face_mesh';
import { BehaviorSubject } from 'rxjs';
import {
  drawConnectors,
  drawLandmarks
} from '@mediapipe/drawing_utils';
import {
  FACEMESH_TESSELATION,
  FACEMESH_RIGHT_EYE,
  FACEMESH_LEFT_EYE
} from '@mediapipe/face_mesh';

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  
  protected readonly title = signal('mirecord-poc');
  @ViewChild('video')
  set video(el: ElementRef<HTMLVideoElement>) {
    if (el) {
      this.videoRef = el;
      this.initCamera();
    }
  }
  videoRef!: ElementRef<HTMLVideoElement>;
  
  @ViewChild('canvas')
  set canvas(el: ElementRef<HTMLCanvasElement>) {
    if (el) {
      this.canvasRef = el;
    }
  }
  canvasRef!: ElementRef<HTMLCanvasElement>;

  type: string
  textInput: string
  documentText: string
  isPlay: WritableSignal<boolean>
  isComplete: WritableSignal<boolean>
  transcript: WritableSignal<string> 
  transcrip = new BehaviorSubject("")
  recognition: any

  mediaRecorder!: MediaRecorder;
  audioChunks: BlobPart[] = [];
  audioUrl: WritableSignal<string | null>
  isRecording: WritableSignal<boolean>;
  passed: WritableSignal<boolean>;
  
  constructor(private http: HttpClient) {
    this.type = "text"
    this.textInput = ""
    this.documentText = ""
    this.isPlay = signal(false)
    this.transcript = signal("")
    this.isComplete = signal(false)
    this.isRecording = signal(false)
    this.audioUrl = signal(null)
    this.passed = signal(false)
  }

  @HostListener('window:resize')
  onResize() {
    this.syncCanvasSize();
  }

  ngAfterViewInit() {
    window.addEventListener('resize', () => {
      this.syncCanvasSize();
    });
  }

  mirrorCanvas(ctx: CanvasRenderingContext2D) {
    const canvas = this.canvasRef.nativeElement;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  isIOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  rotateLandmarksToPortrait(
    landmarks: any[],
    imageWidth: number,
    imageHeight: number
  ) {
    return landmarks.map(p => {
      // rotate -90 deg (clockwise)
      return {
        x: p.y,
        y: 1 - p.x,
        z: p.z,
      };
    });
  }

  initCamera() {
    const faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
      cameraVerticalFovDegrees: 63,
    });

    faceMesh.onResults((results) => this.onResults(results));

    const camera = new Camera(this.videoRef.nativeElement, {
      onFrame: async () => {
        await faceMesh.send({ image: this.videoRef.nativeElement });
      },
      width: 1280,
      height: 720,
    });

    camera.start();
  }

  getEyeAxis(a: any, b: any) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    const length = Math.hypot(dx, dy);

    return {
      x: dx / length,
      y: dy / length,
    };
  }

  getNormal(axis: { x: number; y: number }) {
    return {
      x: -axis.y,
      y: axis.x,
    };
  }

  projectDistance(a: any, b: any, normal: any) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.abs(dx * normal.x + dy * normal.y);
  }

  calculateEyeEARPortraitSafe(
  landmarks: any[],
  eye: 'left' | 'right'
) {
  let outer, inner, v1a, v1b, v2a, v2b;

  if (eye === 'left') {
    outer = landmarks[33];
    inner = landmarks[133];
    v1a = landmarks[160];
    v1b = landmarks[144];
    v2a = landmarks[158];
    v2b = landmarks[153];
  } else {
    outer = landmarks[362];
    inner = landmarks[263];
    v1a = landmarks[385];
    v1b = landmarks[380];
    v2a = landmarks[387];
    v2b = landmarks[373];
  }

  const axis = this.getEyeAxis(outer, inner);
  const normal = this.getNormal(axis);

  const v1 = this.projectDistance(v1a, v1b, normal);
  const v2 = this.projectDistance(v2a, v2b, normal);

  const h = Math.hypot(inner.x - outer.x, inner.y - outer.y);

  return (v1 + v2) / (2 * h);
}

  blinkCount = 0;
  eyeClosed = false;
  lastFaceSeenAt = Date.now();
  faceLostTimeout = 1500; 
  isFaceVisible = signal(true);
  eyeResult = signal<any>(0);
  YAW_THRESHOLD = 0.12;
  headLeft = false;
  headeRight = false;
  onResults(results: any) {
      // if (!results.multiFaceLandmarks) return;
      if (!this.videoRef || !this.canvasRef) return;

      const canvas = this.canvasRef.nativeElement;
      const ctx = canvas.getContext('2d')!;

      //  this.syncCanvasSize();

      canvas.width = results.image.width;
      canvas.height = results.image.height;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        if (Date.now() - this.lastFaceSeenAt > this.faceLostTimeout) {
          this.isFaceVisible.set(false);
        }
        return;
      }

      this.lastFaceSeenAt = Date.now();
      this.isFaceVisible.set(true);

      // ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      let landmarks = results.multiFaceLandmarks[0];

      // if (this.isIOS && this.isPortrait()) {
      //   landmarks = this.rotateLandmarksToPortrait(
      //     landmarks,
      //     results.image.width,
      //     results.image.height
      //   );
      // }

      ctx.save();
      this.mirrorCanvas(ctx);

      drawConnectors(
        ctx,
        landmarks,
        FACEMESH_TESSELATION,
        { color: '#ffffff', lineWidth: 1 }
      );

      drawLandmarks(ctx, landmarks, {
        color: '#00ff00',
        radius: 1
      });

      
      
      ctx.restore();

      //VALIDASI NENGOK KANAN KIRI
      const nose = landmarks[1];
      const leftCheek = landmarks[234];
      const rightCheek = landmarks[454];

      const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
      const faceCenterX = leftCheek.x + faceWidth / 2;

      const yaw = (nose.x - faceCenterX) / faceWidth;

      if (yaw > this.YAW_THRESHOLD) {
        this.headLeft = true;
        console.log('KIRI')
      }
      
      if (yaw < -this.YAW_THRESHOLD) {
        this.headeRight = true;
        console.log('KANAN')
      }

      if (this.headLeft && this.headeRight) {
          this.passed.set(true);
          // this.takePhoto();
      }

      // VALIDASI KEDPIPIN MATA
      // const ear = this.calculateBothEyesEAR(landmarks);
      // if (ear < 0.23 && !this.eyeClosed) {
      //   this.eyeClosed = true;F
      //   this.eyeResult.set(ear)

      // }

      // if (ear > 0.28 && this.eyeClosed) {
      //   this.blinkCount++;
      //   this.eyeClosed = false;
      //   this.eyeResult.set(ear)


      //   if (this.blinkCount > 1) {
      //     this.eyeResult.set(ear)
      //     this.passed.set(true);
      //     this.takePhoto();
      //   }
      // }
    }
  
  // Mengukur reaksi kedipan mata kanan - kiri
  calculateEyeEAR(
    landmarks: any[],
    eye: 'left' | 'right'
  ) {
    let vertical: number;
    let horizontal: number;

    if (eye === 'left') {
      vertical =
        this.distance3D(landmarks[160], landmarks[144]) +
        this.distance3D(landmarks[158], landmarks[153]);

      horizontal =
        this.distance3D(landmarks[33], landmarks[133]);
    } else {
      vertical =
        this.distance3D(landmarks[385], landmarks[380]) +
        this.distance3D(landmarks[387], landmarks[373]);

      horizontal =
        this.distance3D(landmarks[362], landmarks[263]);
    }

    return vertical / (2.0 * horizontal);
  }

  calculateBothEyesEAR(landmarks: any[]) {
    // const leftEAR = this.calculateEyeEAR(landmarks, 'left');
    // const rightEAR = this.calculateEyeEAR(landmarks, 'right');

    // return (leftEAR + rightEAR) / 2;

    const leftEAR = this.calculateEyeEARPortraitSafe(landmarks, 'left');
    const rightEAR = this.calculateEyeEARPortraitSafe(landmarks, 'right');
    const ear = (leftEAR + rightEAR) / 2;

    return ear
  }

  distance(a: any, b: any) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  distance3D(a: any, b: any) {
    return Math.sqrt(
      Math.pow(a.x - b.x, 2) +
      Math.pow(a.y - b.y, 2) +
      Math.pow(a.z - b.z, 2)
    );
  }

  takePhoto() {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const photo = canvas.toDataURL('image/jpeg', 0.9);
  }

  convert() {
    const formData = new FormData();
    formData.append('audio', this.file);
    this.http.post<{text: string}>('http://localhost:3000/stt', formData)
      .subscribe({
        next: (res) => this.transcript.set(res.text),
        error: (err) => console.error(err)
      });
  }

  onSpeech() {
    const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Browser tidak mendukung Speech Recognition');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'id-ID';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onstart = () => {
      this.isPlay.set(true)
    };

    this.recognition.onresult = (event: any) => {
      this.onUserSpeakingAgain();
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        finalText += event.results[i][0].transcript;
      }

      this.transcript.set(finalText)
      this.transcrip.next(finalText)
      if (finalText.toLocaleLowerCase().includes("ngerti") || finalText.toLocaleLowerCase().includes("mengerti")) {
        this.startSilenceCountdown();
      }
    };

    this.recognition.onerror = () => {
      this.isPlay.set(false)
    };

    this.recognition.onend = () => {
      this.isPlay.set(false)
    };

    this.recognition.start();
  }

  silenceTimer: any;
  startSilenceCountdown() {
    clearTimeout(this.silenceTimer);

    this.silenceTimer = setTimeout(() => {
      this.isComplete.set(true)
      this.isRecording.set(true)
    }, 2000);
  }

  onUserSpeakingAgain() {
    this.isComplete.set(false)
    this.isRecording.set(false)
    clearTimeout(this.silenceTimer);
  }

  onSpeak(type: string = "") {
    if (type != 'speech') {
      const text =
        this.type === 'text'
          ? this.textInput
          : this.documentText

      if (!text) {
        alert('Teks masih kosong');
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text)
      const voices = window.speechSynthesis.getVoices();
      utterance.lang = 'id-ID'
      utterance.onstart = () => {
        this.isPlay.set(true)
      }
      utterance.onend = () => {
        this.isPlay.set(false)
      }
      speechSynthesis.cancel()
      speechSynthesis.speak(utterance)
    } else {
      this.onSpeech()
    }
  }

  onStop() {
    speechSynthesis.cancel()
    this.recognition.stop()
    this.isPlay.set(false)
    this.isComplete.set(false)
  }

  selectedFileName: string = ""
  file: any;
  onFileSelected(event: any) {

    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    this.selectedFileName = file.name; 

    if (file.type === 'text/plain') {
      this.readTxtFile(file);
    } 
  }

  readTxtFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      this.documentText = reader.result as string;
    };
    reader.readAsText(file);
  }

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.audioChunks = []

      this.mediaRecorder = new MediaRecorder(stream)

      this.mediaRecorder.ondataavailable = event => {
        this.audioChunks.push(event.data)
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType })
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.file = new File([blob], 'audio.webm', { type: 'audio/webm' });
        this.audioUrl.set(URL.createObjectURL(audioBlob))
      };

      this.mediaRecorder.start()
      this.onSpeech()
      this.isRecording.set(true)
      
    } catch (err) {
      console.error('Cannot access microphone:', err);
    }
  }

  stopRecording() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      this.onStop();
      this.isRecording.set(false)
    }
  }

  onResetTranscript() {
    this.transcript.set("");
    this.stopRecording();
  }

  syncCanvasSize() {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;

    const rect = video.getBoundingClientRect();

    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  drawLandmarksResponsive(ctx: CanvasRenderingContext2D, landmarks: any[]) {
    const canvas = this.canvasRef.nativeElement;

    drawLandmarks(ctx, landmarks, {
      color: '#FF0000',
      radius: (data) => 1.5,
    });
  }
  
}
