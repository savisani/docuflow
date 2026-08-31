import argparse
import json
import sys

from faster_whisper import WhisperModel


def transcribe(audio_path: str, model_size: str = "small") -> dict:
    """Transcribe audio using faster-whisper on GPU with word timestamps."""
    try:
        model = WhisperModel(model_size, device="cuda", compute_type="int8")
        segments_iter, info = model.transcribe(
            audio_path, word_timestamps=True, beam_size=5
        )

        segments = []
        full_text_parts = []
        for i, seg in enumerate(segments_iter):
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3),
                    })

            segments.append({
                "id": i,
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "words": words,
            })
            full_text_parts.append(seg.text.strip())

        return {
            "success": True,
            "text": " ".join(full_text_parts),
            "segments": segments,
            "language": info.language,
            "duration": round(info.duration, 3),
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio using faster-whisper (GPU)."
    )
    parser.add_argument(
        "--audio_path", required=True, help="Path to the audio file."
    )
    parser.add_argument(
        "--output_path",
        default=None,
        help="Path to write the JSON output. Defaults to stdout.",
    )
    parser.add_argument(
        "--model",
        default="small",
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help="Whisper model size (default: small).",
    )
    args = parser.parse_args()

    result = transcribe(args.audio_path, model_size=args.model)

    output_json = json.dumps(result, ensure_ascii=False)

    if args.output_path:
        with open(args.output_path, "w", encoding="utf-8") as f:
            f.write(output_json)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
