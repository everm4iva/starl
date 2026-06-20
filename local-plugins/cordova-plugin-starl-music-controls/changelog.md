I might forget to update this from time to time. But i will still make an afford to show something

## [1.0.9]

### Fixed
- Pausing music no longer stops the foreground service and closes the app. The service now stays alive while paused (releasing wake/wifi locks to save battery) and only stops on explicit close/destroy.

### Added
- Tapping the media notification now always opens the app directly to the maximized player.
  - Warm-start (app backgrounded): handled via `onNewIntent` - emits `music-controls-open-player` to JS immediately.
  - Cold-start (app killed): flag stored in `pendingOpenPlayer`, read by JS via `getAndClearPendingOpenPlayer` after `deviceready`.
