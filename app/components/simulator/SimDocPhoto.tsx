import { Icon } from "~/components/ui/Icon";

/** 证面人像位：有照片（本地 dataURL）显示照片，否则显示占位图标 */
export function SimDocPhoto({ photo }: { photo?: string }) {
  if (photo) {
    return <img className="sim-photo" src={photo} alt="" />;
  }
  return (
    <span className="sim-photo__empty">
      <Icon name="user" size={26} />
    </span>
  );
}
