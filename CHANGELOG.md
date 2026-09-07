# Change Log

All notable changes to the "BehaviorLens" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0] - 2026-09-07

### Added
- Nodes now show the node type and the node name as two separate labels: the
  XML tag (e.g. `ReactiveSequence`) as the primary label, with the `name`
  attribute underneath in a smaller line. Previously only the name was shown,
  so the node type was not visible in the graph. `SubTree` nodes fall back to
  showing their `ID`.
- Previews are restored after a window reload.

### Fixed
- Hiding a preview panel no longer loses the view state. Pan/zoom, the loaded
  node library, expanded subtrees and live node statuses are now persisted and
  restored instead of being rebuilt from scratch.
- Fixed a race where the tree could be sent to a preview before it was ready to
  receive it, which could leave a revealed panel blank.
- Inspection mode can no longer disagree with the ROS bridge: a restored
  inspection view with no bridge running now falls back to editor mode instead
  of showing statuses that will never update.
- Declared explicit activation events, so the extension activates reliably when
  a preview command is invoked.
- `src/ros_bridge.py` is now included in the packaged extension, which
  inspection mode needs at runtime.
- Moved `vue` to devDependencies, since it is bundled into the webview at build
  time and does not need to ship as a runtime dependency.

## [0.1.1] - 2026-02-04
- Version bump only, no functional changes.

## [0.1.0] - 2026-02-04
- Corrected the extension publisher.
- Reduced the size of the overview animation shipped with the extension.

## [0.0.1] - 2026-02-04
- Initial release
- Visual Behavior Tree editor
- ROS 2 live debugging integration
- XML source synchronization
