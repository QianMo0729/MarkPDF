//! macOS microphone consent (TCC). CoreAudio does not fail when access is
//! refused: the stream starts and delivers silence, so a lecture would be
//! "recorded" with nothing in it. Ask AVFoundation first and turn a refusal into
//! the same `mic_permission_denied` error the other platforms report.
//!
//! The prompt text is `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`.

use std::sync::mpsc;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2::{class, msg_send};
use objc2_foundation::NSString;

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    static AVMediaTypeAudio: &'static NSString;
}

// AVAuthorizationStatus
const NOT_DETERMINED: isize = 0;
const AUTHORIZED: isize = 3;

/// Returns once access is granted; shows the system prompt the first time.
/// Blocks while the prompt is open, so call it from a blocking worker.
pub fn ensure_access() -> Result<(), String> {
    let device = class!(AVCaptureDevice);
    let media = unsafe { AVMediaTypeAudio };
    let status: isize = unsafe { msg_send![device, authorizationStatusForMediaType: media] };
    let granted = match status {
        AUTHORIZED => true,
        NOT_DETERMINED => {
            let (tx, rx) = mpsc::channel::<bool>();
            let handler = RcBlock::new(move |granted: Bool| {
                let _ = tx.send(granted.as_bool());
            });
            let _: () = unsafe { msg_send![device, requestAccessForMediaType: media, completionHandler: &*handler] };
            rx.recv().unwrap_or(false)
        }
        _ => false,
    };
    if granted {
        Ok(())
    } else {
        Err("mic_permission_denied: microphone access is turned off for MarkPDF in System Settings".into())
    }
}
