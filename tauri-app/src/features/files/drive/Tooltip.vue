<script setup lang="ts">
defineProps<{title?:string;placement?:string}>()
</script>
<template><a-tooltip :content="title" :position="placement === 'left' ? 'left' : placement === 'right' ? 'right' : 'top'"><slot/></a-tooltip></template>
