// usage: swift ocr.swift IMAGE.png  -> TSV: x y w h (pixels, top-left origin) confidence text
import Foundation
import Vision
import ImageIO
let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
guard let src = CGImageSourceCreateWithURL(url, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fputs("cannot load image\n", stderr); exit(2) }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["zh-Hans", "en-US"]
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
let W = Double(img.width), H = Double(img.height)
print("# vision_revision=\(req.revision) image=\(img.width)x\(img.height)")
for o in req.results ?? [] {
  guard let c = o.topCandidates(1).first else { continue }
  let b = o.boundingBox
  print(String(format: "%.0f\t%.0f\t%.0f\t%.0f\t%.2f\t", b.minX*W, (1-b.maxY)*H, b.width*W, b.height*H, c.confidence) + c.string)
}
