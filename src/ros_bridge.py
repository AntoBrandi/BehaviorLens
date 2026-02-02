import sys
import json
import os

try:
    import rclpy
    from rclpy.node import Node
    from nav2_msgs.msg import BehaviorTreeLog
except ImportError as e:
    print(f"CRITICAL ERROR: {e}", file=sys.stderr)
    print(f"Python Executable: {sys.executable}", file=sys.stderr)
    print(f"System Path: {sys.path}", file=sys.stderr)
    print(f"Environment keys: {list(os.environ.keys())}", file=sys.stderr)
    # Check specifically for PYTHONPATH
    print(f"PYTHONPATH: {os.environ.get('PYTHONPATH', 'NOT SET')}", file=sys.stderr)
    sys.exit(1)

class BehaviorTreeBridge(Node):
    def __init__(self, topic_name):
        super().__init__('behavior_tree_vscode_bridge')
        self.declare_parameter('topic_name', topic_name)
        topic_name = self.get_parameter('topic_name').value
        self.subscription = self.create_subscription(
            BehaviorTreeLog,
            topic_name,
            self.listener_callback,
            10)
        self.get_logger().info(f'Bridge started, listening on {topic_name}')

    def listener_callback(self, msg):
        # Convert msg to JSON
        # msg has timestamp and event_log (list of BehaviorTreeStatusChange)
        # BehaviorTreeStatusChange: node_name, previous_status, current_status
        
        events = []
        for event in msg.event_log:
            events.append({
                'node_name': event.node_name,
                'previous_status': event.previous_status,
                'current_status': event.current_status
            })
            
        data = {
            'timestamp': {
                'sec': msg.timestamp.sec,
                'nanosec': msg.timestamp.nanosec
            },
            'event_log': events
        }
        
        # Print JSON to stdout
        try:
            print(json.dumps(data), flush=True)
        except Exception as e:
            self.get_logger().error(f"Error encoding JSON: {e}")

def main(args=None):
    rclpy.init(args=args)
    bridge = BehaviorTreeBridge('/behavior_tree_log')
    try:
        rclpy.spin(bridge)
        bridge.destroy_node()
        rclpy.shutdown()
    except Exception:
        pass  

if __name__ == '__main__':
    main()
