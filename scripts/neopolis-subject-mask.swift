import Foundation
import Vision
import CoreImage
import AppKit
let input = URL(fileURLWithPath: CommandLine.arguments[1]), output = URL(fileURLWithPath: CommandLine.arguments[2])
let handler = VNImageRequestHandler(url: input)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else { print("no subject"); exit(2) }
print("instances", result.allInstances.count)
let mask = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let image = CIImage(cvPixelBuffer: mask)
let context = CIContext()
try context.writePNGRepresentation(of: image, to: output, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
