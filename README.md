<div align="center">
  <img src="media/icon.png" width="128" />
  <h1>BehaviorLens</h1>
</div>

**The Ultimate Visual Studio Code Extension for BehaviorTree.CPP**

[BehaviorTree.CPP](https://github.com/BehaviorTree/BehaviorTree.CPP) is a fantastic library, and behavior trees are powerful. **BehaviorLens** brings that power directly into VS Code with a fully interactive, visual editor and debugger.

![BehaviorLens Overview](media/assets/BehaviorLensOverview.gif)

## ✨ Features

### 🌲 Visual Editor & Preview
Stop staring at raw XML. Visualize your Behavior Trees with a modern, interactive graph editor.
- **Drag & Drop Reordering**: Organize your trees intuitively.
- **Node Management**: Add, remove, and rename nodes easily with the context menu.
- **Edit Attributes**: Modify node parameters directly in the UI.
- **Smart Connection**: Connect nodes with validation to prevent cycles.

![BehaviorLens Editor](media/assets/BehaviorLensEditor.gif)

### 🤖 Live ROS 2 Integration
Debug your robot's logic in real-time. BehaviorLens bridges directly to your ROS 2 stack to visualize execution state.
- **Live Status Visualization**: See nodes transition (`IDLE`, `RUNNING`, `SUCCESS`, `FAILURE`) as your robot thinks.
- **Inspection Mode**: One-click subscription to `/behavior_tree_log`.
  - **Configurable Topic**: You can change the topic in settings if your robot publishes elsewhere.
  - **Message Type**: Expects `nav2_msgs/msg/BehaviorTreeLog` ([Definition](https://github.com/ros-navigation/navigation2/blob/main/nav2_msgs/msg/BehaviorTreeLog.msg)).
- **Auto-Discovery**: Automatically detects ROS 2 distributions (Humble, Jazzy) and sources them.

![BehaviorLens ROS 2 Debugging](media/assets/BehaviorLensROS2Debugging.gif)

### ⚡ Seamless Synchronization
- **Bi-directional Sync**: Changes in the visual editor update the XML file instantly, and manual text edits update the visual tree.
- **Side-by-Side View**: Code on the left, visual tree on the right. Perfect for understanding complex files.

### 🎨 Beautiful Preview
- **Node Icons**: Distinct icons for Actions, Conditions, Controls, and Decorators types.
- **Native Look & Feel**: Matches your VS Code theme (Dark/Light).

## 🚀 Getting Started

1.  **Install** the extension from the Marketplace.
2.  Open any `.xml` file containing a Behavior Tree.
3.  Click the **Open Preview** icon in the editor title bar, or run `BehaviorLens: Open Preview`.
4.  **Edit**: Drag nodes, click to edit attributes, or use the context menu.
5.  **Debug**: Use the "Inspect" toggle in the preview to listen to ROS 2 topics.

## 🔧 Requirements

- **VS Code** 1.75.0 or higher.
- **ROS 2** (Humble, Jazzy, or Iron) is required for **Live Integration** features only.
  - *Note: Standard visualization and editing works perfectly without ROS.*
- **Python 3** with `rclpy` (if using ROS bridge).

## ⌨️ Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `behaviortree.preview` | **Open Preview** | Opens the visual editor in the current editor group. |
| `behaviortree.previewSide` | **Open Preview to the Side** | Opens the visual editor in a separate column. |

## 🧩 Advanced Features

### 🔌 Port Visualization
BehaviorLens automatically visualizes input and output ports for your nodes.
- **Blackboard Variables**: Easily see which blackboard keys a node reads from or writes to.
- **Data Flow**: Understand the data dependencies in your behavior tree at a glance.

### 📚 Load Custom Node Libraries
Work with custom actions and conditions? No problem.
1.  Open the **Command Palette** (`Ctrl+Shift+P`).
2.  Run `BehaviorLens: Load Library`.
3.  Select your XML file containing the node definitions.
4.  Your custom nodes will appear in the side panel, ready to be dragged into your tree.

## 🤝 Support

If you encounter issues or have feature requests, please [open an issue](https://github.com/AntoBrandi/BehaviorLens/issues).

---
*Built for the Robotics Community.*
