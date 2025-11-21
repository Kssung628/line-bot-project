export function makeFlexMenu(){
  return {
    type:'flex', altText:'選擇操作', contents:{
      type:'bubble', body:{ type:'box', layout:'vertical', contents:[
        {type:'text', text:'保單規劃 - 快速選單', weight:'bold', size:'md'},
        {type:'button', action:{type:'message', label:'開始規劃', text:'開始規劃'}},
        {type:'button', action:{type:'message', label:'貼上保單連結', text:'我要貼保單連結'}},
        {type:'button', action:{type:'message', label:'查詢客戶', text:'查詢 客戶'}}
      ]}
    }
  };
}
