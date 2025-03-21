import { RealtimeConfig } from "@/app/store";

import Locale from "@/app/locales";
import { ListItem } from "@/app/components/ui-lib";

const models = ["gpt-4o-realtime-preview-2024-10-01"];

const voice = ["alloy", "shimmer", "echo"];

export function RealtimeConfigList(props: {
  realtimeConfig: RealtimeConfig;
  updateConfig: (updater: (config: RealtimeConfig) => void) => void;
}) {
  return (
    <>
      <ListItem
        title={Locale.Settings.Realtime.Enable.Title}
        subTitle={Locale.Settings.Realtime.Enable.SubTitle}
      >
        <input
          type="checkbox"
          checked={props.realtimeConfig.enable}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.enable = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem>
    </>
  );
}
