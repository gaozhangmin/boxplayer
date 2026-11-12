export const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hrs > 0
        ? `${hrs}:${mins.toString().padStart(2, "0")}:${secs
              .toString()
              .padStart(2, "0")}`
        : `${mins.toString().padStart(2, "0")}:${secs
              .toString()
              .padStart(2, "0")}`;
};
