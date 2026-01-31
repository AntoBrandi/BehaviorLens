import rclpy
from rclpy.node import Node
from nav2_msgs.msg import BehaviorTreeLog
import json
import sys

class BehaviorTreeBridge(Node):
    def __init__(self):
        super().__init__('behavior_tree_vscode_bridge')
        self.subscription = self.create_subscription(
            BehaviorTreeLog,
            '/behavior_tree_log',
            self.listener_callback,
            10)
        self.subscription  # prevent unused variable warning
        self.get_logger().info('Bridge started, listening on /behavior_tree_log')

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
    bridge = BehaviorTreeBridge()
    try:
        rclpy.spin(bridge)
    except KeyboardInterrupt:
        pass
    finally:
        bridge.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
