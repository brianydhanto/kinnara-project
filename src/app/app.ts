import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, signal, ViewChild, WritableSignal } from '@angular/core';
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
    });

    faceMesh.onResults((results) => this.onResults(results));

    const camera = new Camera(this.videoRef.nativeElement, {
      onFrame: async () => {
        await faceMesh.send({ image: this.videoRef.nativeElement });
      },
      width: 720,
      height: 480,
    });

    camera.start();
  }

  blinkCount = 0;
  eyeClosed = false;
  onResults(results: any) {
      if (!results.multiFaceLandmarks) return;

      const canvas = this.canvasRef.nativeElement;
      const ctx = canvas.getContext('2d')!;

      canvas.width = results.image.width;
      canvas.height = results.image.height;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      const landmarks = results.multiFaceLandmarks[0];

      drawConnectors(
        ctx,
        landmarks,
        FACEMESH_TESSELATION,
        { color: '#00FF00', lineWidth: 1 }
      );

      drawLandmarks(ctx, landmarks, {
        color: '#FF0000',
        radius: 1
      });

      ctx.restore();

      const ear = this.calculateEAR(landmarks);

      if (ear < 0.2 && !this.eyeClosed) {
        this.eyeClosed = true;
      }

      if (ear > 0.25 && this.eyeClosed) {
        this.blinkCount++;
        this.eyeClosed = false;

        if (this.blinkCount > 1) {
          this.passed.set(true);
          this.takePhoto();
        }
      }
    }

  calculateEAR(landmarks: any[]) {
    const vertical =
      this.distance(landmarks[160], landmarks[144]) +
      this.distance(landmarks[158], landmarks[153]);

    const horizontal = this.distance(
      landmarks[33],
      landmarks[133]
    );

    return vertical / (2.0 * horizontal);
  }

  distance(a: any, b: any) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  takePhoto() {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const photo = canvas.toDataURL('image/jpeg', 0.9);
    console.log('Snapshot:', photo);
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
  }
  
}
