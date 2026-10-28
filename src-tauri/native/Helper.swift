import Foundation
import AppKit
import Vision
let data = FileHandle.standardInput.readDataToEndOfFile()
do {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    let handler = VNImageRequestHandler(data: data)
    try handler.perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    print(text)
} catch {
    FileHandle.standardError.write(Data("OCR failed. Verify that the screenshot is readable.\n".utf8))
    exit(1)
}
