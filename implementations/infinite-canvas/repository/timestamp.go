package repository

import (
	"fmt"
	"strings"
	"time"
)

func localTimestampAfter(left string, right string) (bool, error) {
	leftTime, err := parseLocalTimestamp(left)
	if err != nil {
		return false, fmt.Errorf("已保存的更新时间无效：%w", err)
	}
	rightTime, err := parseLocalTimestamp(right)
	if err != nil {
		return false, fmt.Errorf("提交的更新时间无效：%w", err)
	}
	return leftTime.After(rightTime), nil
}

func validateLocalTimestamp(value string) error {
	_, err := parseLocalTimestamp(value)
	return err
}

func parseLocalTimestamp(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("时间戳不能为空")
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("时间戳必须符合 RFC3339：%w", err)
	}
	return parsed, nil
}
